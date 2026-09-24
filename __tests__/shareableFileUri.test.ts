import { csvShareErrorMessage, toShareableFileUri } from '../src/utils/shareableFileUri';

describe('toShareableFileUri', () => {
  it('prefixes a local Android path with file://', () => {
    expect(toShareableFileUri('/data/user/0/com.djtranscendence.pizzawala/cache/PizzaWala-hygiene-2026-09.csv')).toBe(
      'file:///data/user/0/com.djtranscendence.pizzawala/cache/PizzaWala-hygiene-2026-09.csv'
    );
  });

  it('keeps existing file, content, and data URIs', () => {
    expect(toShareableFileUri('file:///tmp/export.csv')).toBe('file:///tmp/export.csv');
    expect(toShareableFileUri('content://com.djtranscendence.pizzawala.fileprovider/cache/export.csv')).toBe(
      'content://com.djtranscendence.pizzawala.fileprovider/cache/export.csv'
    );
    expect(toShareableFileUri('data:text/csv;base64,YQ==')).toBe('data:text/csv;base64,YQ==');
  });

  it('rejects empty paths so Share.open never receives a null URI', () => {
    expect(() => toShareableFileUri('')).toThrow('Missing export file path.');
    expect(() => toShareableFileUri('   ')).toThrow('Missing export file path.');
  });
});

describe('csvShareErrorMessage', () => {
  it('hides share-sheet cancellation', () => {
    expect(csvShareErrorMessage({ message: 'User did not share' })).toBe('');
  });

  it('replaces the Android getScheme NPE with a readable message', () => {
    expect(
      csvShareErrorMessage({
        message: "Attempt to invoke virtual method 'java.lang.String android.net.Uri.getScheme()' on a null object reference",
      })
    ).toBe('Could not open the CSV file for download. Please try again.');
  });
});
