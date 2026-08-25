import XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import {
  CATALOG_IMPORT_HEADERS,
  CATALOG_IMPORT_SHEET,
  parseCatalogImportFile,
} from '../../src/client/features/owner/catalog-excel';

async function workbookFile(rows: Array<Array<string | number | null>>, name = 'catalog.xlsx') {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([[...CATALOG_IMPORT_HEADERS], ...rows]),
    CATALOG_IMPORT_SHEET,
  );
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  return new File([bytes], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('catalog Excel parser', () => {
  it('parses canonical Vietnamese values without evaluating values', async () => {
    const file = await workbookFile([
      [
        null,
        null,
        'Nước cam',
        'Số lượng',
        'Đồ uống',
        'Ly',
        'Size M',
        '15,000',
        '10.000',
        'Không',
        '#F97316',
        'Cam tươi',
      ],
    ]);
    await expect(parseCatalogImportFile(file)).resolves.toMatchObject([
      { sourceRow: 2, name: 'Nước cam', salePrice: '15,000', costPrice: '10.000' },
    ]);
  });

  it('rejects formula cells and unsupported extensions', async () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([[...CATALOG_IMPORT_HEADERS], [null, null, 'Nước suối']]);
    sheet.H2 = { f: '1+1', t: 'n', v: 2 };
    XLSX.utils.book_append_sheet(book, sheet, CATALOG_IMPORT_SHEET);
    const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' })], 'formula.xlsx');
    await expect(parseCatalogImportFile(file)).rejects.toMatchObject({
      code: 'FORMULA_NOT_ALLOWED',
    });
    await expect(parseCatalogImportFile(new File(['data'], 'catalog.xls'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE',
    });
  });

  it('rejects empty, oversized, corrupt, missing-sheet, and malformed-header files', async () => {
    await expect(parseCatalogImportFile(new File([], 'empty.xlsx'))).rejects.toMatchObject({
      code: 'EMPTY_FILE',
    });
    await expect(
      parseCatalogImportFile(new File([new Uint8Array(1_000_001)], 'large.xlsx')),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(
      parseCatalogImportFile(new File(['not a workbook'], 'bad.xlsx')),
    ).rejects.toMatchObject({
      code: 'INVALID_XLSX',
    });

    const withoutCanonicalSheet = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      withoutCanonicalSheet,
      XLSX.utils.aoa_to_sheet([['Tên mặt hàng *']]),
      'Khác',
    );
    await expect(
      parseCatalogImportFile(
        new File(
          [XLSX.write(withoutCanonicalSheet, { type: 'array', bookType: 'xlsx' })],
          'sheet.xlsx',
        ),
      ),
    ).rejects.toMatchObject({ code: 'SHEET_NOT_FOUND' });

    const duplicateHeader = await workbookFile([[null, null, 'Nước suối']]);
    const duplicateBook = XLSX.read(await duplicateHeader.arrayBuffer(), { type: 'array' });
    duplicateBook.Sheets[CATALOG_IMPORT_SHEET]!.C1 = { t: 's', v: CATALOG_IMPORT_HEADERS[0] };
    await expect(
      parseCatalogImportFile(
        new File(
          [XLSX.write(duplicateBook, { type: 'array', bookType: 'xlsx' })],
          'duplicate.xlsx',
        ),
      ),
    ).rejects.toMatchObject({ code: 'HEADER_DUPLICATE' });
  });
});
