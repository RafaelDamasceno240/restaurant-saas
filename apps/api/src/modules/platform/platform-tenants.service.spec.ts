import { maskDocument } from './platform-tenants.service';

describe('maskDocument', () => {
  it('shows only the first and last two digits of a CNPJ and the last two of a CPF', () => {
    expect(maskDocument('12345678000199')).toBe('12.***.***/****-99');
    expect(maskDocument('11144477735')).toBe('***.***.***-35');
  });

  it('never shows a document it does not recognise in full', () => {
    expect(maskDocument('123456')).toBe('****56');
    expect(maskDocument('1')).toBe('**');
  });
});
