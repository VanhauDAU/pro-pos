import type {
  CatalogImportIssue,
  CatalogImportRow,
  CatalogImportSummary,
} from '@contracts/catalog';

export const CATALOG_IMPORT_SHEET = 'Danh sách mặt hàng';
export const CATALOG_IMPORT_MAX_BYTES = 1_000_000;
export const CATALOG_IMPORT_MAX_ROWS = 2_000;

export const CATALOG_IMPORT_HEADERS = [
  'ID hệ thống (không sửa)',
  'ID phiên bản (không sửa)',
  'Tên mặt hàng *',
  'Loại mặt hàng *',
  'Danh mục',
  'Đơn vị',
  'Tên phiên bản',
  'Giá bán (VND)',
  'Giá vốn (VND)',
  'Nhập giá khi bán',
  'Màu đại diện',
  'Mô tả',
  'Giá cơ bản TIME (VND)',
  'Thời lượng cơ bản TIME (phút)',
  'Cách tính TIME',
  'Làm tròn tiền TIME (VND)',
  'Bật kỳ đầu',
  'Thời lượng kỳ đầu (phút)',
  'Giá kỳ đầu (VND)',
] as const;

export interface CatalogExcelError extends Error {
  code: string;
}

export interface CatalogExportRow extends Omit<CatalogImportRow, 'sourceRow'> {
  sourceRow?: number;
}

function timeTemplateRow(input: {
  name: string;
  basePrice: string;
  durationMinutes: string;
  firstPeriodEnabled: 'Có' | 'Không';
  firstPeriodDurationMinutes: string | null;
  firstPeriodPrice: string | null;
  avatarColor: string;
}): CatalogExportRow {
  return {
    productId: null,
    variantId: null,
    name: input.name,
    productType: 'Thời gian',
    categoryName: 'Dịch vụ',
    unitName: 'Giờ',
    variantName: null,
    salePrice: null,
    costPrice: null,
    promptPrice: 'Không',
    avatarColor: input.avatarColor,
    description: `Dịch vụ ${input.name.toLocaleLowerCase('vi')}`,
    timeBasePrice: input.basePrice,
    timeBaseDurationMinutes: input.durationMinutes,
    timeCalculationMode: 'Thời gian thực tế',
    timeRoundingUnit: '1.000',
    timeFirstPeriodEnabled: input.firstPeriodEnabled,
    timeFirstPeriodDurationMinutes: input.firstPeriodDurationMinutes,
    timeFirstPeriodPrice: input.firstPeriodPrice,
  };
}

// Dữ liệu minh họa theo ngữ cảnh billiards. Vì không có ID, các dòng này sẽ
// được xem là CREATE nếu người dùng import; sheet Hướng dẫn yêu cầu xóa chúng
// trước khi nhập danh mục thật.
export const CATALOG_TEMPLATE_SAMPLE_ROWS: CatalogExportRow[] = [
  {
    productId: null,
    variantId: null,
    name: 'Coca Cola 330ml',
    productType: 'Số lượng',
    categoryName: 'Đồ uống',
    unitName: 'Lon',
    variantName: 'Mặc định',
    salePrice: '15.000',
    costPrice: '10.000',
    promptPrice: 'Không',
    avatarColor: '#C62828',
    description: 'Nước ngọt có gas',
    timeBasePrice: null,
    timeBaseDurationMinutes: null,
    timeCalculationMode: null,
    timeRoundingUnit: null,
    timeFirstPeriodEnabled: null,
    timeFirstPeriodDurationMinutes: null,
    timeFirstPeriodPrice: null,
  },
  {
    productId: null,
    variantId: null,
    name: 'Bia Tiger',
    productType: 'Số lượng',
    categoryName: 'Đồ uống',
    unitName: 'Lon',
    variantName: 'Mặc định',
    salePrice: '22.000',
    costPrice: '16.000',
    promptPrice: 'Không',
    avatarColor: '#F59E0B',
    description: 'Bia lon Tiger',
    timeBasePrice: null,
    timeBaseDurationMinutes: null,
    timeCalculationMode: null,
    timeRoundingUnit: null,
    timeFirstPeriodEnabled: null,
    timeFirstPeriodDurationMinutes: null,
    timeFirstPeriodPrice: null,
  },
  {
    productId: null,
    variantId: null,
    name: 'Nước suối',
    productType: 'Số lượng',
    categoryName: 'Đồ uống',
    unitName: 'Chai',
    variantName: 'Mặc định',
    salePrice: '10.000',
    costPrice: '6.000',
    promptPrice: 'Không',
    avatarColor: '#0284C7',
    description: 'Nước suối đóng chai',
    timeBasePrice: null,
    timeBaseDurationMinutes: null,
    timeCalculationMode: null,
    timeRoundingUnit: null,
    timeFirstPeriodEnabled: null,
    timeFirstPeriodDurationMinutes: null,
    timeFirstPeriodPrice: null,
  },
  {
    productId: null,
    variantId: null,
    name: 'Nước cam',
    productType: 'Số lượng',
    categoryName: 'Đồ uống',
    unitName: 'Ly',
    variantName: 'Size M',
    salePrice: '30.000',
    costPrice: '18.000',
    promptPrice: 'Không',
    avatarColor: '#F97316',
    description: 'Nước cam tươi',
    timeBasePrice: null,
    timeBaseDurationMinutes: null,
    timeCalculationMode: null,
    timeRoundingUnit: null,
    timeFirstPeriodEnabled: null,
    timeFirstPeriodDurationMinutes: null,
    timeFirstPeriodPrice: null,
  },
  {
    productId: null,
    variantId: null,
    name: 'Nước cam',
    productType: 'Số lượng',
    categoryName: 'Đồ uống',
    unitName: 'Ly',
    variantName: 'Size L',
    salePrice: '40.000',
    costPrice: '24.000',
    promptPrice: 'Không',
    avatarColor: '#F97316',
    description: 'Nước cam tươi',
    timeBasePrice: null,
    timeBaseDurationMinutes: null,
    timeCalculationMode: null,
    timeRoundingUnit: null,
    timeFirstPeriodEnabled: null,
    timeFirstPeriodDurationMinutes: null,
    timeFirstPeriodPrice: null,
  },
  {
    productId: null,
    variantId: null,
    name: 'Khoai tây chiên',
    productType: 'Số lượng',
    categoryName: 'Đồ ăn',
    unitName: 'Phần',
    variantName: 'Mặc định',
    salePrice: '35.000',
    costPrice: '20.000',
    promptPrice: 'Không',
    avatarColor: '#EAB308',
    description: 'Khoai tây chiên giòn',
    timeBasePrice: null,
    timeBaseDurationMinutes: null,
    timeCalculationMode: null,
    timeRoundingUnit: null,
    timeFirstPeriodEnabled: null,
    timeFirstPeriodDurationMinutes: null,
    timeFirstPeriodPrice: null,
  },
  {
    productId: null,
    variantId: null,
    name: 'Trái cây theo kg',
    productType: 'Trọng lượng',
    categoryName: 'Đồ ăn',
    unitName: 'kg',
    variantName: 'Mặc định',
    salePrice: '80.000',
    costPrice: '50.000',
    promptPrice: 'Không',
    avatarColor: '#22C55E',
    description: 'Trái cây tươi tính theo kilogram',
    timeBasePrice: null,
    timeBaseDurationMinutes: null,
    timeCalculationMode: null,
    timeRoundingUnit: null,
    timeFirstPeriodEnabled: null,
    timeFirstPeriodDurationMinutes: null,
    timeFirstPeriodPrice: null,
  },
  {
    productId: null,
    variantId: null,
    name: 'Phụ thu nhập giá khi bán',
    productType: 'Số lượng',
    categoryName: 'Dịch vụ',
    unitName: 'Lần',
    variantName: 'Mặc định',
    salePrice: null,
    costPrice: '0',
    promptPrice: 'Có',
    avatarColor: '#64748B',
    description: 'Nhân viên nhập giá bán khi tạo đơn',
    timeBasePrice: null,
    timeBaseDurationMinutes: null,
    timeCalculationMode: null,
    timeRoundingUnit: null,
    timeFirstPeriodEnabled: null,
    timeFirstPeriodDurationMinutes: null,
    timeFirstPeriodPrice: null,
  },
  timeTemplateRow({
    name: 'Giờ chơi Pool',
    basePrice: '60.000',
    durationMinutes: '60',
    firstPeriodEnabled: 'Không',
    firstPeriodDurationMinutes: null,
    firstPeriodPrice: null,
    avatarColor: '#2563EB',
  }),
  timeTemplateRow({
    name: 'Giờ chơi Carom',
    basePrice: '70.000',
    durationMinutes: '60',
    firstPeriodEnabled: 'Có',
    firstPeriodDurationMinutes: '30',
    firstPeriodPrice: '40.000',
    avatarColor: '#7C3AED',
  }),
  timeTemplateRow({
    name: 'Giờ chơi Phòng VIP',
    basePrice: '120.000',
    durationMinutes: '60',
    firstPeriodEnabled: 'Có',
    firstPeriodDurationMinutes: '60',
    firstPeriodPrice: '120.000',
    avatarColor: '#BE123C',
  }),
];

function failure(code: string, message: string): CatalogExcelError {
  return Object.assign(new Error(message), { code });
}

function cellText(value: unknown) {
  if (value === undefined || value === null) return null;
  return String(value).trim() || null;
}

function safeText(value: string | null) {
  if (!value || !/^[=+\-@]/u.test(value)) return value ?? '';
  return `'${value}`;
}

async function xlsx() {
  const module = await import('xlsx');
  return module.default ?? module;
}

export async function parseCatalogImportFile(file: File): Promise<CatalogImportRow[]> {
  if (file.size === 0) throw failure('EMPTY_FILE', 'File Excel đang trống.');
  if (file.size > CATALOG_IMPORT_MAX_BYTES) {
    throw failure('FILE_TOO_LARGE', 'File vượt quá 1 MB. Vui lòng chia nhỏ dữ liệu.');
  }
  if (!file.name.toLocaleLowerCase('vi').endsWith('.xlsx')) {
    throw failure('UNSUPPORTED_FILE_TYPE', 'Chỉ hỗ trợ file .xlsx.');
  }
  const XLSX = await xlsx();
  const buffer = await file.arrayBuffer();
  const signature = new Uint8Array(buffer.slice(0, 4));
  if (
    signature.length !== 4 ||
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b ||
    signature[2] !== 0x03 ||
    signature[3] !== 0x04
  ) {
    throw failure('INVALID_XLSX', 'File không phải workbook .xlsx hợp lệ.');
  }
  let workbook: ReturnType<typeof XLSX.read>;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellFormula: true });
  } catch {
    throw failure('INVALID_XLSX', 'Không thể đọc file Excel.');
  }
  const sheet = workbook.Sheets[CATALOG_IMPORT_SHEET];
  if (!sheet) throw failure('SHEET_NOT_FOUND', `Không tìm thấy sheet "${CATALOG_IMPORT_SHEET}".`);
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1');
  let headerRow = -1;
  for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 10); row += 1) {
    const first = cellText(sheet[XLSX.utils.encode_cell({ r: row, c: range.s.c })]?.v);
    if (first === CATALOG_IMPORT_HEADERS[0]) {
      headerRow = row;
      break;
    }
  }
  if (headerRow < 0) throw failure('HEADER_MISSING', 'Không tìm thấy hàng tiêu đề chuẩn.');
  const seen = new Set<string>();
  for (let column = 0; column < CATALOG_IMPORT_HEADERS.length; column += 1) {
    const header = cellText(sheet[XLSX.utils.encode_cell({ r: headerRow, c: column })]?.v);
    if (!header) throw failure('HEADER_MISSING', `Thiếu cột "${CATALOG_IMPORT_HEADERS[column]}".`);
    if (seen.has(header)) throw failure('HEADER_DUPLICATE', `Cột "${header}" bị trùng.`);
    seen.add(header);
    if (header !== CATALOG_IMPORT_HEADERS[column]) {
      throw failure(
        'HEADER_MISSING',
        `Cột phải có tên chính xác "${CATALOG_IMPORT_HEADERS[column]}".`,
      );
    }
  }
  const rows: CatalogImportRow[] = [];
  for (let row = headerRow + 1; row <= range.e.r; row += 1) {
    const values = CATALOG_IMPORT_HEADERS.map((_, column) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.f) throw failure('FORMULA_NOT_ALLOWED', `Dòng ${row + 1} chứa công thức Excel.`);
      return cellText(cell?.v);
    });
    if (values.every((value) => value === null)) continue;
    if (rows.length >= CATALOG_IMPORT_MAX_ROWS) {
      throw failure('TOO_MANY_ROWS', 'Tối đa 2.000 dòng dữ liệu. Vui lòng chia nhỏ file.');
    }
    rows.push({
      sourceRow: row + 1,
      productId: values[0]!,
      variantId: values[1]!,
      name: values[2] ?? '',
      productType: values[3] ?? '',
      categoryName: values[4]!,
      unitName: values[5]!,
      variantName: values[6]!,
      salePrice: values[7]!,
      costPrice: values[8]!,
      promptPrice: values[9]!,
      avatarColor: values[10]!,
      description: values[11]!,
      timeBasePrice: values[12]!,
      timeBaseDurationMinutes: values[13]!,
      timeCalculationMode: values[14]!,
      timeRoundingUnit: values[15]!,
      timeFirstPeriodEnabled: values[16]!,
      timeFirstPeriodDurationMinutes: values[17]!,
      timeFirstPeriodPrice: values[18]!,
    });
  }
  if (rows.length === 0) throw failure('EMPTY_FILE', 'Sheet không có dữ liệu mặt hàng.');
  return rows;
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function downloadCatalogWorkbook(
  rows: CatalogExportRow[],
  fileName: string,
  includeGuidance = false,
) {
  const XLSX = await xlsx();
  const data = [
    [...CATALOG_IMPORT_HEADERS],
    ...rows.map((row) =>
      CATALOG_IMPORT_HEADERS.map((_, index) =>
        safeText(
          [
            row.productId,
            row.variantId,
            row.name,
            row.productType,
            row.categoryName,
            row.unitName,
            row.variantName,
            row.salePrice,
            row.costPrice,
            row.promptPrice,
            row.avatarColor,
            row.description,
            row.timeBasePrice,
            row.timeBaseDurationMinutes,
            row.timeCalculationMode,
            row.timeRoundingUnit,
            row.timeFirstPeriodEnabled,
            row.timeFirstPeriodDurationMinutes,
            row.timeFirstPeriodPrice,
          ][index] ?? '',
        ),
      ),
    ),
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = CATALOG_IMPORT_HEADERS.map((header) => ({
    wch: Math.max(16, header.length + 2),
  }));
  XLSX.utils.book_append_sheet(workbook, sheet, CATALOG_IMPORT_SHEET);
  if (includeGuidance) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Giá trị tham chiếu'],
        ['Loại mặt hàng', 'Nhập giá khi bán', 'Cách tính TIME', 'Làm tròn TIME'],
        ['Số lượng', 'Có', 'Thời gian thực tế', '0'],
        ['Trọng lượng', 'Không', 'Theo khung thời gian', '100'],
        ['Thời gian', '', '', '500 / 1000 / 5000'],
      ]),
      'Tham chiếu',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Hướng dẫn nhập mặt hàng Pro POS'],
        [
          'Dòng dữ liệu trong sheet Danh sách mặt hàng là VÍ DỤ. Hãy xóa chúng trước khi nhập dữ liệu thật.',
        ],
        ['Giữ nguyên tên các cột. Mỗi phiên bản là một dòng và tên mặt hàng phải lặp lại.'],
        ['ID hệ thống/ID phiên bản để trống khi tạo mới; chỉ cập nhật khi ID xuất từ Pro POS.'],
      ]),
      'Hướng dẫn',
    );
  }
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: false });
  download(
    new Blob([output], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName,
  );
}

export async function downloadCatalogImportReport(input: {
  rows: CatalogImportRow[];
  issues: CatalogImportIssue[];
  summary: CatalogImportSummary;
  fileName: string;
  mode: 'error' | 'result';
}) {
  const XLSX = await xlsx();
  const issueByRow = new Map(input.issues.map((item) => [item.sourceRow, item]));
  const rows = input.rows
    .filter((row) => input.mode === 'result' || issueByRow.has(row.sourceRow))
    .map((row) => {
      const issue = issueByRow.get(row.sourceRow)!;
      return [
        ...CATALOG_IMPORT_HEADERS.map((_, index) =>
          safeText(
            [
              row.productId,
              row.variantId,
              row.name,
              row.productType,
              row.categoryName,
              row.unitName,
              row.variantName,
              row.salePrice,
              row.costPrice,
              row.promptPrice,
              row.avatarColor,
              row.description,
              row.timeBasePrice,
              row.timeBaseDurationMinutes,
              row.timeCalculationMode,
              row.timeRoundingUnit,
              row.timeFirstPeriodEnabled,
              row.timeFirstPeriodDurationMinutes,
              row.timeFirstPeriodPrice,
            ][index] ?? '',
          ),
        ),
        issue?.action ?? 'COMPLETED',
        issue?.errorCode ?? '',
        issue?.field ?? '',
        safeText(issue?.message ?? 'Đã xử lý.'),
        safeText(issue?.suggestion ?? ''),
      ];
    });
  const workbook = XLSX.utils.book_new();
  const headers = [
    ...CATALOG_IMPORT_HEADERS,
    'Trạng thái',
    'Mã lỗi',
    'Cột lỗi',
    'Chi tiết lỗi',
    'Gợi ý sửa',
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    input.mode === 'result' ? 'Kết quả' : 'Dữ liệu cần sửa',
  );
  if (input.mode === 'result') {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        headers,
        ...rows.filter((_, index) => issueByRow.has(input.rows[index]!.sourceRow)),
      ]),
      'Lỗi',
    );
  }
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Chỉ số', 'Giá trị'],
      ['Tổng dòng', input.summary.totalRows],
      ['Tạo mới', input.summary.createProducts],
      ['Cập nhật', input.summary.updateProducts],
      ['Bỏ qua', input.summary.skippedProducts],
      ['Lỗi', input.summary.errorRows],
    ]),
    'Tổng kết',
  );
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: false });
  download(
    new Blob([output], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    input.fileName,
  );
}
