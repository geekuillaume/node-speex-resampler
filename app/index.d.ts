/// <reference types="node" />
import { Transform } from 'stream';
declare class SpeexResampler {
    channels: any;
    inRate: any;
    outRate: any;
    quality: number;
    _processing: boolean;
    _resamplerPtr: number;
    _inBufferPtr: number;
    _inBufferSize: number;
    _outBufferPtr: number;
    _outBufferSize: number;
    _inLengthPtr: number;
    _outLengthPtr: number;
    /**
      * Create an SpeexResampler tranform stream.
      * @param channels Number of channels, minimum is 1, no maximum
      * @param inRate frequency in Hz for the input chunk
      * @param outRate frequency in Hz for the target chunk
      * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
      */
    constructor(channels: any, inRate: any, outRate: any, quality?: number);
    /**
      * Resample a chunk of audio.
      * @param chunk interleaved PCM data in signed 16bits int
      */
    processChunk(chunk: Buffer): Promise<Buffer>;
}
export declare class SpeexResamplerTransform extends Transform {
    channels: any;
    inRate: any;
    outRate: any;
    quality: number;
    resampler: SpeexResampler;
    _alignementBuffer: Buffer;
    /**
      * Create an SpeexResampler instance.
      * @param channels Number of channels, minimum is 1, no maximum
      * @param inRate frequency in Hz for the input chunk
      * @param outRate frequency in Hz for the target chunk
      * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
      */
    constructor(channels: any, inRate: any, outRate: any, quality?: number);
    _transform(chunk: any, encoding: any, callback: any): Promise<void>;
}
export default SpeexResampler;
