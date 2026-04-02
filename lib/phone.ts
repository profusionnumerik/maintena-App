// lib/phone.ts

export function onlyPhoneDigits(value: string): string {
    return value.replace(/\D/g, "").slice(0, 10);
  }
  
  export function formatFrenchPhone(value: string): string {
    const digits = onlyPhoneDigits(value);
    return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  }
  
  export function isValidFrenchPhone(value: string): boolean {
    return onlyPhoneDigits(value).length === 10;
  }
  
  export function normalizeFrenchPhone(value: string): string {
    return onlyPhoneDigits(value);
  }