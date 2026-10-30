const westernGroups = /^\d{1,3}(?:,\d{3})+$/;
const indianGroups = /^\d{1,2}(?:,\d{2})*,\d{3}$/;
const groupedInteger = (value: string) => westernGroups.test(value) || indianGroups.test(value);

/** Keep invalid input visible. Never turn malformed text into a different payable amount. */
export function normalizeDecimalInput(raw: string): string {
  const value = raw.trim();
  if (/^\d*\.?\d*$/.test(value)) return value;
  // A grouped paste with an explicit decimal separator is unambiguous.
  const decimal = value.includes(',') && value.includes('.')
    ? (value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.') : null;
  if (decimal) {
    const index = value.lastIndexOf(decimal);
    const integer = value.slice(0, index).replace(/\./g, ',');
    const fraction = value.slice(index + 1);
    if (groupedInteger(integer) && /^\d+$/.test(fraction)) return `${integer.replace(/,/g, '')}.${fraction}`;
    return raw;
  }
  // Mobile decimal keyboards may offer only comma. Three trailing digits can
  // also be a thousands group, so require a dot for that ambiguous case.
  if (/^\d*,\d*$/.test(value)) {
    const [integer, fraction] = value.split(',');
    if (fraction.length !== 3 || Number(integer) === 0) return `${integer}.${fraction}`;
  }
  if ((value.match(/,/g)?.length ?? 0) > 1 && groupedInteger(value)) return value.replace(/,/g, '');
  const spaced = value.match(/^(\d{1,3}(?:[ \u00a0\u202f]\d{3})+)([.,]\d+)?$/);
  if (spaced) return spaced[1].replace(/[ \u00a0\u202f]/g, '') + (spaced[2]?.replace(',', '.') ?? '');
  return raw;
}

export function normalizeIntegerInput(raw: string): string {
  const value = raw.trim();
  if (/^\d*$/.test(value)) return value;
  const grouped = value.replace(/[ \u00a0\u202f]/g, ',');
  return groupedInteger(grouped) ? grouped.replace(/,/g, '') : raw;
}

export function validAmountInput(value: string, fractionSize: number): boolean {
  if (fractionSize === 0) return /^\d+$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
  return /^(?:\d+\.?\d*|\.\d+)$/.test(value) && (value.split('.')[1]?.length ?? 0) <= fractionSize
    && Number.isFinite(Number(value)) && Number(value) > 0;
}
