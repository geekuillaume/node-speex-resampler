/// <reference types="emscripten" />

import { Transform } from 'stream';
import SpeexWasm from './speex_wasm';

interface EmscriptenModuleOpusEncoder extends EmscriptenModule {
  _speex_resampler_init(nbChannels: number, inRate: number, outRate: number, quality: number, errPointer: number): number;
  _speex_resampler_destroy(resamplerPtr: number): void;
  _speex_resampler_get_rate(resamplerPtr: number, inRatePtr: number, outRatePtr: number);
  _speex_resampler_process_interleaved_int(resamplerPtr: number, inBufferPtr: number, inLenPtr: number, outBufferPtr: number, outLenPtr: number): number;
  _speex_resampler_strerror(err: number): number;

  getValue(ptr: number, type: string): any;
  setValue(ptr: number, value: any, type: string): any;
  AsciiToString(ptr: number): string;
}

let speexModule: EmscriptenModuleOpusEncoder;
let globalModulePromise = SpeexWasm().then((s) => speexModule = s);

class SpeexResampler {
  _processing = false;
  _resamplerPtr: number;
  _inBufferPtr = -1;
  _inBufferSize = -1;
  _outBufferPtr = -1;
  _outBufferSize = -1;

  _inLengthPtr = -1;
  _outLengthPtr = -1;

  /**
    * Create an SpeexResampler tranform stream.
    * @param channels Number of channels, minimum is 1, no maximum
    * @param inRate frequency in Hz for the input chunk
    * @param outRate frequency in Hz for the target chunk
    * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
    */
  constructor(
    public channels,
    public inRate,
    public outRate,
    public quality = 7) {}

  /**
    * Resample a chunk of audio.
    * @param chunk interleaved PCM data in signed 16bits int
    */
  async processChunk(chunk: Buffer) {
    if (this._processing) {
      throw new Error('You can only process one chunk at a time, do not parallelize this function');
    }
    // We check that we have as many chunks for each channel and that the last chunk is full (2 bytes)
    if (chunk.length % (this.channels * Uint16Array.BYTES_PER_ELEMENT) !== 0) {
      throw new Error('Chunk length should be a multiple of channels * 2 bytes');
    }

    this._processing = true;
    await globalModulePromise;
    if (!this._resamplerPtr) {
      const errPtr = speexModule._malloc(4);
      this._resamplerPtr = speexModule._speex_resampler_init(this.channels, this.inRate, this.outRate, this.quality, errPtr);
      const errNum = speexModule.getValue(errPtr, 'i32');
      if (errNum !== 0) {
        throw new Error(speexModule.AsciiToString(speexModule._speex_resampler_strerror(errNum)));
      }
      this._inLengthPtr = speexModule._malloc(Uint32Array.BYTES_PER_ELEMENT);
      this._outLengthPtr = speexModule._malloc(Uint32Array.BYTES_PER_ELEMENT);
    }

    // Resizing the input buffer in the WASM memory space to match what we need
    if (this._inBufferSize < chunk.length) {
      if (this._inBufferPtr !== -1) {
        speexModule._free(this._inBufferPtr);
      }
      this._inBufferPtr = speexModule._malloc(chunk.length);
      this._inBufferSize = chunk.length;
    }

    // Resizing the output buffer in the WASM memory space to match what we need
    const outBufferLengthTarget = Math.ceil(chunk.length * this.outRate / this.inRate);
    if (this._outBufferSize < outBufferLengthTarget) {
      if (this._outBufferPtr !== -1) {
        speexModule._free(this._outBufferPtr);
      }
      this._outBufferPtr = speexModule._malloc(outBufferLengthTarget);
      this._outBufferSize = outBufferLengthTarget;
    }

    // number of samples per channel in input buffer
    speexModule.setValue(this._inLengthPtr, chunk.length / this.channels / Uint16Array.BYTES_PER_ELEMENT, 'i32');
    // Copying the info from the input Buffer in the WASM memory space
    speexModule.HEAPU8.set(chunk, this._inBufferPtr);

    // number of samples per channels available in output buffer
    speexModule.setValue(this._outLengthPtr, this._outBufferSize / this.channels / Uint16Array.BYTES_PER_ELEMENT, 'i32');
    const errNum = speexModule._speex_resampler_process_interleaved_int(
      this._resamplerPtr,
      this._inBufferPtr,
      this._inLengthPtr,
      this._outBufferPtr,
      this._outLengthPtr,
    );

    if (errNum !== 0) {
      throw new Error(speexModule.AsciiToString(speexModule._speex_resampler_strerror(errNum)));
    }

    const outSamplesPerChannelsWritten = speexModule.getValue(this._outLengthPtr, 'i32');

    this._processing = false;
    // we are copying the info in a new buffer here, we could just pass a buffer pointing to the same memory space if needed
    return Buffer.from(
      speexModule.HEAPU8.subarray(
        this._outBufferPtr,
        this._outBufferPtr + outSamplesPerChannelsWritten * this.channels * Uint16Array.BYTES_PER_ELEMENT
      ));
  }
}

const EMPTY_BUFFER = Buffer.alloc(0);

export class SpeexResamplerTransform extends Transform {
  resampler: SpeexResampler;
  _alignementBuffer: Buffer;

  /**
    * Create an SpeexResampler instance.
    * @param channels Number of channels, minimum is 1, no maximum
    * @param inRate frequency in Hz for the input chunk
    * @param outRate frequency in Hz for the target chunk
    * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
    */
  constructor(public channels, public inRate, public outRate, public quality = 7) {
    super();
    this.resampler = new SpeexResampler(channels, inRate, outRate, quality);
    this.channels = channels;
    this._alignementBuffer = EMPTY_BUFFER;
  }

  async _transform(chunk, encoding, callback) {
    let chunkToProcess: Buffer = chunk;
    if (this._alignementBuffer.length > 0) {
      chunkToProcess = Buffer.concat([
        this._alignementBuffer,
        chunk,
      ]);
      this._alignementBuffer = EMPTY_BUFFER;
    }
    // Speex needs a buffer aligned to 16bits times the number of channels
    // so we keep the extraneous bytes in a buffer for next chunk
    const extraneousBytesCount = chunkToProcess.length % (this.channels * Uint16Array.BYTES_PER_ELEMENT);
    if (extraneousBytesCount !== 0) {
      this._alignementBuffer = Buffer.from(chunkToProcess.slice(chunkToProcess.length - extraneousBytesCount));
      chunkToProcess = chunkToProcess.slice(0, chunkToProcess.length - extraneousBytesCount);
    }
    try {
      const res = await this.resampler.processChunk(chunkToProcess);
      callback(null, res);
    } catch (e) {
      callback(e);
    }
  }
}

export default SpeexResampler;
