import {
  Transcript,
  WhisperTranscriber,
  WhisperTranscriberConfiguration,
} from 'pocketstation/demo';
import { Capture } from 'pocketstation/node';

const application = process.argv[2];
if (!application) throw new Error('Run with a running desktop application name');

const model = process.env.PKS_WHISPER_MODEL;
if (!model) {
  throw new Error('Set PKS_WHISPER_MODEL to a local whisper.cpp model file');
}

const live = new Capture({
  application,
  microphone: true,
  streamAudio: false,
});
const transcription = new WhisperTranscriber(new WhisperTranscriberConfiguration({
  model,
}));
const transcriptSubscription = transcription.attachMany(live.session, live.stems);

await live.start();
try {
  for await (const envelope of live.signals(transcriptSubscription)) {
    if (envelope.payload.kind !== 'text') {
      throw new TypeError('transcription Operator emitted a non-text signal');
    }
    const transcript = Transcript.fromJson(envelope.payload.text);
    console.log(`source ${transcript.sourceId}: ${transcript.text}`);
  }
} finally {
  await live.close();
}
