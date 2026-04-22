import { renderPdfV2 } from './engine/renderer';
import type { FormSchema } from './engine/types';
export { renderPdfV2 } from './engine/renderer';

export async function downloadPdfV2<T>(schema: FormSchema<T>, data: T, filename: string): Promise<void> {
  const doc = await renderPdfV2(schema, data);
  doc.save(filename);
}
