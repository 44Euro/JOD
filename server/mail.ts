// Password-reset email through Resend's HTTP API; the sender's domain has to be verified in Resend first.
export function createResendMail(apiKey: string, from: string, fetchFn: typeof fetch = (i, o) => fetch(i, o)) {
  return async (to: string, subject: string, text: string) => {
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    })
    if (!res.ok) throw new Error(`mail failed: ${res.status}`)
  }
}
