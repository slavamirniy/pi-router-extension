"""Bounded ASR chunks; split at the quietest 100 ms window near each boundary."""
def audio_segments(samples,rate):
    start=0
    while start<len(samples):
        end=min(len(samples),start+20*rate)
        if end<len(samples):
            window=rate//10
            candidates=range(start+16*rate,end-window+1,window)
            quiet=min(candidates,key=lambda i:float((samples[i:i+window]**2).mean()))
            end=quiet+window//2
        yield start,end
        start=end
