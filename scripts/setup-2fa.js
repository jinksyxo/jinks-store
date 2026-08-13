import { randomBytes } from 'node:crypto'
import qrcodeTerminal from 'qrcode-terminal'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buffer) {
  let bits = ''

  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0')
  }

  let output = ''

  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0')
    output += BASE32_ALPHABET[parseInt(chunk, 2)]
  }

  return output
}

const issuer = 'matsumoto*'
const accountLabel = 'admin'
const secret = base32Encode(randomBytes(20))
const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
  accountLabel,
)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`

console.log('\nScan this with Google Authenticator, Authy, 1Password, or any TOTP app:\n')

qrcodeTerminal.generate(otpauthUri, { small: true }, (qrCode) => {
  console.log(qrCode)
  console.log(`Can't scan it? Enter this key manually instead: ${secret}\n`)
  console.log('Add this to .env.local (and to Railway once you deploy):\n')
  console.log(`ADMIN_TOTP_SECRET=${secret}\n`)
  console.log(
    'This secret is only shown once — if you lose it, just run this script again to\ngenerate a new one and re-scan.\n',
  )
})
