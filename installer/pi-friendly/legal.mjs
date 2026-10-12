export const legal = {
  "offer": {
    "url": "https://docs.google.com/document/d/1i0lFtU-wZs2PMSTqsNERffocrgrtuhPrQJ0gGtit6Us/edit?usp=sharing",
    "version": "offer-2026-08-05"
  },
  "privacy": {
    "url": "https://docs.google.com/document/d/1o4-bb58cSFfZEOTkbM8XbpyqkSpfQs78iEbF8LImP4Q/edit?usp=sharing",
    "version": "privacy-published-2026-10-09-v1"
  },
  "consent": {
    "url": "https://docs.google.com/document/d/1IMrd9ElHADgBpssXseFwCfM76tVcN09yNWloK-41jTE/edit?usp=sharing",
    "version": "consent-published-2026-10-09-v1"
  }
};
export const telegramURL = "https://t.me/get_ai_access_bot";
export function validConsent(c){return c?.offer===true&&c?.personalData===true&&["offer","privacy","consent"].every(k=>c.versions?.[k]===legal[k].version);}
