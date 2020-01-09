/// <reference types="node" />
import { Transform } from 'stream';

declare class SpeexResamplerTransformStream extends Transform {
  /**
  * Create an SpeexResampler tranform stream.
  * @param channels Number of channels, minimum is 1, no maximum
  * @param inRate frequency in Hz for the input chunk
  * @param outRate frequency in Hz for the target chunk
  * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
  */
 constructor(channels: number, inRate: number, outRate: number, quality?: number);
}

declare class SpeexResampler {
  /**
  * Create an SpeexResampler instance.
  * @param channels Number of channels, minimum is 1, no maximum
  * @param inRate frequency in Hz for the input chunk
  * @param outRate frequency in Hz for the target chunk
  * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
  */
  constructor(channels: number, inRate: number, outRate: number, quality?: number);

  /**
  * Resample a chunk of audio.
  * @param pcmData interleaved PCM data in signed 16bits int
  */
  processChunk(pcmData: Buffer): Buffer;

  static TransformStream: typeof SpeexResamplerTransformStream;
}

export = SpeexResampler;
