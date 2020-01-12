const { Transform } = require('stream');
const nativeSpeex = require('bindings')('speex-resampler');

class SpeexResampler {
  constructor(channels, inRate, outRate, quality) {
    this._channels = channels;
    this._resampler = nativeSpeex.createResampler(channels, inRate, outRate, quality);
  }

  processChunk(chunk) {
    // We check that we have as many chunks for each channel and that the last chunk is full (2 bytes)
    if (chunk.length % (this._channels * 2) !== 0) {
      throw new Error('Chunk length should be a multiple of channels * 2 bytes');
    }
    return new Promise((resolve, reject) => {
      nativeSpeex.resampleChunk(this._resampler, chunk, this._channels, (err, buf) => {
        if (err) {
          return reject(err);
        }
        resolve(buf);
      })
    });
  }
}

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
      const res = await this.resampler.processChunk(chunkToProcess);
      callback(null, res);
    } catch (e) {
      callback(e);
    }
  }
}

SpeexResampler.TransformStream = SpeexResamplerTransform;

module.exports = SpeexResampler;
