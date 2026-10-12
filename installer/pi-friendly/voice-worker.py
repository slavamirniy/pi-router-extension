"""Local-only GigaAM worker. JSON lines on stdin/stdout; never persists microphone audio."""
import argparse,json,sys,threading,time,os
parser=argparse.ArgumentParser()
parser.add_argument('--model',required=True)
parser.add_argument('--file')
args=parser.parse_args()
sys.stdout.reconfigure(encoding='utf-8');sys.stdin.reconfigure(encoding='utf-8')
lock=threading.RLock()
def emit(**data):
    with lock:
        print(json.dumps(data,ensure_ascii=False),flush=True)
try:
    import numpy as np
    import onnxruntime as ort
    import onnx_asr
    options=ort.SessionOptions()
    options.intra_op_num_threads=max(1,min(4,os.cpu_count() or 1))
    model=onnx_asr.load_model('gigaam-v3-e2e-ctc',args.model,quantization='int8',providers=['CPUExecutionProvider'],sess_options=options)
except Exception as exc:
    emit(type='error',message='Не удалось загрузить GigaAM. Нажмите «Повторить».',detail=str(exc));sys.exit(1)
from voice_audio import audio_segments
import miniaudio
if args.file:
    decoded=miniaudio.decode_file(args.file,output_format=miniaudio.SampleFormat.FLOAT32,nchannels=1,sample_rate=16000)
    samples=np.asarray(decoded.samples,dtype=np.float32)
    parts=[]
    for start,end in audio_segments(samples,16000):
        parts.append(model.recognize(samples[start:end],sample_rate=16000))
        emit(type='transcribing',id='file',percent=round(end/len(samples)*100))
    emit(type='text',id='file',text=' '.join(parts));sys.exit(0)
capture=None
chunks=[]
current=None
busy=False
started=0.0

def stop_recording(request_id,cancel=False):
    global capture,chunks,current,busy
    with lock:
        if request_id!=current:return
        if busy:
            if cancel:current=None
            return
        device=capture;capture=None;busy=not cancel
    if device:
        try:
            device.stop();device.close()
        except Exception as exc:
            with lock:
                current=None;busy=False;chunks=[]
            emit(type='error',message='Микрофон был отключён. Подключите его и повторите запись.',detail=str(exc))
            emit(type='ready');return
    with lock:
        if request_id!=current:return
        audio=b''.join(chunks);chunks=[]
        if cancel:
            current=None;busy=False;emit(type='ready');return
        busy=True
    emit(type='transcribing',id=request_id)
    def recognize():
        global busy,current
        try:
            samples=np.frombuffer(audio,dtype=np.float32)
            parts=[]
            for start,end in audio_segments(samples,16000):
                with lock:
                    if current!=request_id:return
                segment=samples[start:end]
                if len(segment)>=3200 and float(np.max(np.abs(segment)))>=0.003:
                    parts.append(model.recognize(segment,sample_rate=16000))
                emit(type='transcribing',id=request_id,percent=round(end/max(1,len(samples))*100))
            text=' '.join(part.strip() for part in parts if part.strip())
            with lock:
                if current==request_id:emit(type='text',id=request_id,text=text)
        except Exception as exc:
            with lock:
                if current==request_id:emit(type='error',message='Не получилось распознать речь. Попробуйте ещё раз.',detail=str(exc))
        finally:
            with lock:
                if current==request_id:current=None
                busy=False;emit(type='ready')
    threading.Thread(target=recognize,daemon=True).start()

def start_recording(request_id):
    global capture,chunks,current,started
    with lock:
        if capture is not None or busy:return
        current=request_id;chunks=[];started=time.monotonic()
    try:
        device=miniaudio.CaptureDevice(input_format=miniaudio.SampleFormat.FLOAT32,nchannels=1,sample_rate=16000,buffersize_msec=100)
        def receiver():
            data=yield
            while True:
                with lock:
                    if current==request_id:chunks.append(bytes(data))
                data=yield
        generator=receiver();next(generator)
        capture=device;device.start(generator)
        emit(type='recording',id=request_id,seconds=0)
        def timer():
            while True:
                time.sleep(0.1)
                with lock:
                    if current!=request_id or capture is None:return
                    elapsed=time.monotonic()-started
                if elapsed>=600:stop_recording(request_id);return
                with lock:
                    latest=np.frombuffer(chunks[-1],dtype=np.float32) if chunks else np.zeros(1)
                    level=min(1.0,float(np.sqrt(np.mean(latest*latest)))*12)
                emit(type='recording',id=request_id,seconds=int(elapsed),level=level)
        threading.Thread(target=timer,daemon=True).start()
    except Exception as exc:
        if capture:
            try:capture.close()
            except Exception:pass
        capture=None;current=None
        emit(type='error',message='Нет доступа к микрофону. Подключите его и разрешите запись для терминала в настройках системы.',detail=str(exc))
        emit(type='ready')

emit(type='ready')
try:
    for line in sys.stdin:
        try:
            command=json.loads(line)
            if command['type']=='start':start_recording(command['id'])
            elif command['type']=='stop':stop_recording(command['id'])
            elif command['type']=='cancel':stop_recording(command['id'],True)
            elif command['type']=='shutdown':break
        except Exception as exc:emit(type='error',message='Ошибка голосового ввода. Повторите запись.',detail=str(exc))
finally:
    if capture:
        capture.stop();capture.close()
