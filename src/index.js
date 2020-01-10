const { Transform } = require('stream');
const SpeexResampler = require('bindings')('speex-resampler').SpeexResampler;

class SpeexResamplerTransform extends Transform {
  constructor(channels, inRate, outRate, quality = 7) {
    super();
    this.resampler = new SpeexResampler(channels, inRate, outRate, quality);
    this.channels = channels;
    this._alignementBuffer = Buffer.alloc(this.channels * 2);
    this._alignementBufferLength = 0;
  }

  async _transform(chunk, encoding, callback) {
    let chunkToProcess = chunk;
    if (this._alignementBufferLength > 0) {
      chunkToProcess = Buffer.concat([
        this._alignementBuffer.subarray(0, this._alignementBufferLength),
        chunk,
      ]);
      this._alignementBufferLength = 0;
    }
    // Speex needs a buffer aligned to 16bits times the number of channels
    // so we keep the extraneous bytes in a buffer for next chunk
    const extraneousBytesCount = chunkToProcess.length % (this.channels * 2);
    if (extraneousBytesCount !== 0) {
      chunkToProcess.copy(this._alignementBuffer, 0, extraneousBytesCount);
      chunkToProcess = chunkToProcess.subarray(0, chunkToProcess.length - extraneousBytesCount);
      this._alignementBufferLength = extraneousBytesCount;
    }
    try {
      const res = await this.resampler.processChunk(chunk);
      callback(null, res);
    } catch (e) {
      callback(e);
    }
  }
}

SpeexResampler.TransformStream = SpeexResamplerTransform;

module.exports = SpeexResampler;
