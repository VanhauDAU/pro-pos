import { describe, expect, it } from 'vitest';
import { createBatchServiceTablesSchema } from '../../src/contracts/catalog';

function generateTableNames(
  prefix: string,
  startNumber: number,
  quantity: number,
  useZeroPadding = false,
) {
  const result: string[] = [];
  for (let i = 0; i < quantity; i++) {
    const currentNum = startNumber + i;
    const numStr =
      useZeroPadding && currentNum < 10
        ? String(currentNum).padStart(2, '0')
        : String(currentNum);
    result.push(`${prefix}${numStr}`.trim());
  }
  return result;
}

describe('Bulk Table Creation Schema & Generation', () => {
  it('validates valid batch table payload', () => {
    const validPayload = {
      areaId: '123e4567-e89b-12d3-a456-426614174000',
      timeProductId: '123e4567-e89b-12d3-a456-426614174001',
      tables: [
        { name: 'Bàn 01', sortOrder: 1 },
        { name: 'Bàn 02', sortOrder: 2 },
        { name: 'Bàn 03', sortOrder: 3 },
      ],
    };

    const parsed = createBatchServiceTablesSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tables).toHaveLength(3);
      expect(parsed.data.tables[0]?.name).toBe('Bàn 01');
    }
  });

  it('rejects batch payload with empty tables array or invalid areaId', () => {
    const emptyTables = {
      areaId: '123e4567-e89b-12d3-a456-426614174000',
      tables: [],
    };
    expect(createBatchServiceTablesSchema.safeParse(emptyTables).success).toBe(false);

    const invalidAreaId = {
      areaId: 'not-a-uuid',
      tables: [{ name: 'Bàn 1' }],
    };
    expect(createBatchServiceTablesSchema.safeParse(invalidAreaId).success).toBe(false);
  });

  it('rejects batch payload exceeding 100 tables', () => {
    const tooManyTables = {
      areaId: '123e4567-e89b-12d3-a456-426614174000',
      tables: Array.from({ length: 101 }, (_, i) => ({ name: `Bàn ${i + 1}` })),
    };
    expect(createBatchServiceTablesSchema.safeParse(tooManyTables).success).toBe(false);
  });

  it('generates sequential table names accurately with prefix and start number', () => {
    // Default case
    expect(generateTableNames('Bàn ', 1, 5, false)).toEqual([
      'Bàn 1',
      'Bàn 2',
      'Bàn 3',
      'Bàn 4',
      'Bàn 5',
    ]);

    // Zero-padded case
    expect(generateTableNames('Bàn ', 1, 5, true)).toEqual([
      'Bàn 01',
      'Bàn 02',
      'Bàn 03',
      'Bàn 04',
      'Bàn 05',
    ]);

    // Offset starting number
    expect(generateTableNames('Phòng ', 101, 3, false)).toEqual([
      'Phòng 101',
      'Phòng 102',
      'Phòng 103',
    ]);

    // VIP prefix with continuing index
    expect(generateTableNames('VIP-', 5, 3, true)).toEqual([
      'VIP-05',
      'VIP-06',
      'VIP-07',
    ]);
  });
});
