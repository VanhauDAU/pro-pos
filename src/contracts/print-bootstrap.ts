import type { StorePrintSettings } from './store';

export interface PrintStoreContext {
  storeId?: string | null;
  storeName?: string | null;
  storeAddress?: string | null;
  storePhone?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  store?: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankAccountName?: string | null;
  };
}

export interface PrintBootstrap {
  context: PrintStoreContext;
  printSettings: StorePrintSettings;
  configVersion: number;
}
