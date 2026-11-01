// Picking an Otter transcript on the phone and reading it as text. The web build has its own
// version beside this one (transcriptFile.web.ts). Otter's Text export is a .txt file; anything
// else is read too, and transcriptProblem says whether it's usable.

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { TRANSCRIPT_MAX } from '../domain/otterMinutes';

export const TRANSCRIPT_UNREADABLE = 'That file couldn’t be read. Export it from Otter as Text (.txt).';
const TOO_BIG = 'That file is too big for one meeting. Export it from Otter as Text (.txt).';
// A UTF-8 character can take up to 4 bytes; refuse files far past the text limit before reading them.
const MAX_FILE_BYTES = TRANSCRIPT_MAX * 4;

/** Lets the secretary pick the transcript and reads it as text. Null when they back out. */
export async function pickTranscript(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const asset = result.assets[0];
  if (asset.size !== undefined && asset.size > MAX_FILE_BYTES) throw new Error(TOO_BIG);
  try {
    return { name: asset.name, text: await new File(asset.uri).text() };
  } catch {
    throw new Error(TRANSCRIPT_UNREADABLE);
  }
}
