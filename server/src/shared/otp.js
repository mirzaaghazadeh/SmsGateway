// Finds the one-time code (OTP) in an SMS, so it can be copied with one tap. Shared by the server
// (Telegram) and the panel. Only SMS that talk about a code count, and only 4-8 digit numbers that
// are not part of an amount, a date or a phone number.

const WORDS = /(code|otp|pass ?code|password|\bpin\b|verif|token|login|kod|şifre|sifre|doğrulama|parola|clave|código|codice|کد|رمز|код|пароль)/i;
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

export function findCode(text) {
  if (!text) return null;
  const t = String(text)
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC.indexOf(d)));
  if (!WORDS.test(t)) return null;
  // "123-456" / "123 456", or 4-8 digits; not after a digit, "+", "." or ",", not before a digit,
  // ":", "/" or a decimal part
  const re = /(?<![\d+.,])(\d{3}[- ]\d{3}(?!\d)|\d{4,8})(?![\d:/,]|\.\d)/g;
  let m;
  while ((m = re.exec(t))) {
    const code = m[1].replace(/[- ]/g, '');
    if (code.length >= 4 && code.length <= 8) return code;
  }
  return null;
}
