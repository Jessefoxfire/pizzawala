import TextRecognition from '@react-native-ml-kit/text-recognition';
import { parseReceiptText } from '../domain/receipts/parseReceiptText';
import { emptyCandidate, type ReceiptCandidate, type RecognitionSnapshot } from '../domain/receipts/types';

export const RECEIPT_RECOGNITION_PROVIDER = 'mlkit-text-recognition';

export type ReceiptRecognizer = {
  recognizeText(imageUri: string): Promise<string>;
};

const mlKitRecognizer: ReceiptRecognizer = {
  async recognizeText(imageUri: string) {
    const result = await TextRecognition.recognize(imageUri);
    return result?.text || '';
  },
};

export async function recognizeReceiptImages(
  imageUris: string[],
  recognizer: ReceiptRecognizer = mlKitRecognizer
): Promise<RecognitionSnapshot> {
  if (!imageUris.length) return { ...emptyCandidate('failed'), provider: RECEIPT_RECOGNITION_PROVIDER };
  const chunks: string[] = [];
  try {
    for (const uri of imageUris) {
      const text = await recognizer.recognizeText(uri);
      if (text.trim()) chunks.push(text.trim());
    }
  } catch (error) {
    console.warn('Receipt recognition failed:', error);
    return { ...emptyCandidate('failed'), provider: RECEIPT_RECOGNITION_PROVIDER };
  }
  const candidate: ReceiptCandidate = chunks.length ? parseReceiptText(chunks.join('\n')) : emptyCandidate('failed');
  return { ...candidate, provider: RECEIPT_RECOGNITION_PROVIDER };
}
