"use strict";
/// <reference types="emscripten" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeexResamplerTransform = void 0;
const stream_1 = require("stream");
const speex_wasm_1 = __importDefault(require("./speex_wasm"));
let speexModule;
let globalModulePromise = speex_wasm_1.default().then((s) => speexModule = s);
class SpeexResampler {
    /**
      * Create an SpeexResampler tranform stream.
      * @param channels Number of channels, minimum is 1, no maximum
      * @param inRate frequency in Hz for the input chunk
      * @param outRate frequency in Hz for the target chunk
      * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
      */
    constructor(channels, inRate, outRate, quality = 7) {
        this.channels = channels;
        this.inRate = inRate;
        this.outRate = outRate;
        this.quality = quality;
        this._inBufferPtr = -1;
        this._inBufferSize = -1;
        this._outBufferPtr = -1;
        this._outBufferSize = -1;
        this._inLengthPtr = -1;
        this._outLengthPtr = -1;
    }
    /**
      * Resample a chunk of audio.
      * @param chunk interleaved PCM data in signed 16bits int
      */
    processChunk(chunk) {
        if (!speexModule) {
            throw new Error('You need to wait for SpeexResampler.initPromise before calling this method');
        }
        // We check that we have as many chunks for each channel and that the last chunk is full (2 bytes)
        if (chunk.length % (this.channels * Uint16Array.BYTES_PER_ELEMENT) !== 0) {
            throw new Error('Chunk length should be a multiple of channels * 2 bytes');
        }
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
        const errNum = speexModule._speex_resampler_process_interleaved_int(this._resamplerPtr, this._inBufferPtr, this._inLengthPtr, this._outBufferPtr, this._outLengthPtr);
        if (errNum !== 0) {
            throw new Error(speexModule.AsciiToString(speexModule._speex_resampler_strerror(errNum)));
        }
        const outSamplesPerChannelsWritten = speexModule.getValue(this._outLengthPtr, 'i32');
        // we are copying the info in a new buffer here, we could just pass a buffer pointing to the same memory space if needed
        return Buffer.from(speexModule.HEAPU8.subarray(this._outBufferPtr, this._outBufferPtr + outSamplesPerChannelsWritten * this.channels * Uint16Array.BYTES_PER_ELEMENT));
    }
}
SpeexResampler.initPromise = globalModulePromise;
const EMPTY_BUFFER = Buffer.alloc(0);
class SpeexResamplerTransform extends stream_1.Transform {
    /**
      * Create an SpeexResampler instance.
      * @param channels Number of channels, minimum is 1, no maximum
      * @param inRate frequency in Hz for the input chunk
      * @param outRate frequency in Hz for the target chunk
      * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
      */
    constructor(channels, inRate, outRate, quality = 7) {
        super();
        this.channels = channels;
        this.inRate = inRate;
        this.outRate = outRate;
        this.quality = quality;
        this.resampler = new SpeexResampler(channels, inRate, outRate, quality);
        this.channels = channels;
        this._alignementBuffer = EMPTY_BUFFER;
    }
    _transform(chunk, encoding, callback) {
        let chunkToProcess = chunk;
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
            const res = this.resampler.processChunk(chunkToProcess);
            callback(null, res);
        }
        catch (e) {
            callback(e);
        }
    }
}
exports.SpeexResamplerTransform = SpeexResamplerTransform;
exports.default = SpeexResampler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiLyIsInNvdXJjZXMiOlsiaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG9DQUFvQzs7Ozs7O0FBRXBDLG1DQUFtQztBQUNuQyw4REFBcUM7QUFjckMsSUFBSSxXQUF3QyxDQUFDO0FBQzdDLElBQUksbUJBQW1CLEdBQUcsb0JBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsV0FBVyxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBRW5FLE1BQU0sY0FBYztJQVlsQjs7Ozs7O1FBTUk7SUFDSixZQUNTLFFBQVEsRUFDUixNQUFNLEVBQ04sT0FBTyxFQUNQLFVBQVUsQ0FBQztRQUhYLGFBQVEsR0FBUixRQUFRLENBQUE7UUFDUixXQUFNLEdBQU4sTUFBTSxDQUFBO1FBQ04sWUFBTyxHQUFQLE9BQU8sQ0FBQTtRQUNQLFlBQU8sR0FBUCxPQUFPLENBQUk7UUFyQnBCLGlCQUFZLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbEIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNuQixrQkFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ25CLG1CQUFjLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFcEIsaUJBQVksR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNsQixrQkFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBZUksQ0FBQztJQUV4Qjs7O1FBR0k7SUFDSixZQUFZLENBQUMsS0FBYTtRQUN4QixJQUFJLENBQUMsV0FBVyxFQUFFO1lBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsNEVBQTRFLENBQUMsQ0FBQztTQUMvRjtRQUNELGtHQUFrRztRQUNsRyxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxHQUFHLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsRUFBRTtZQUN4RSxNQUFNLElBQUksS0FBSyxDQUFDLHlEQUF5RCxDQUFDLENBQUM7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QUM7UUFDbkMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtZQUNyQyxjQUFjLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztnQkFDN0IsSUFBSSxDQUFDLGlCQUFpQjtnQkFDdEIsS0FBSzthQUNOLENBQUMsQ0FBQztZQUNILElBQUksQ0FBQyxpQkFBaUIsR0FBRyxZQUFZLENBQUM7U0FDdkM7UUFDRCxzRUFBc0U7UUFDdEUsNkRBQTZEO1FBQzdELE1BQU0sb0JBQW9CLEdBQUcsY0FBYyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLEdBQUcsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDckcsSUFBSSxvQkFBb0IsS0FBSyxDQUFDLEVBQUU7WUFDOUIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsTUFBTSxHQUFHLG9CQUFvQixDQUFDLENBQUMsQ0FBQztZQUN6RyxjQUFjLEdBQUcsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsY0FBYyxDQUFDLE1BQU0sR0FBRyxvQkFBb0IsQ0FBQyxDQUFDO1NBQ3hGO1FBQ0QsSUFBSTtZQUNGLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ3hELFFBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7U0FDckI7UUFBQyxPQUFPLENBQUMsRUFBRTtZQUNWLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUNiO0lBQ0gsQ0FBQztDQUNGO0FBekNELDBEQXlDQztBQUVELGtCQUFlLGNBQWMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vLyA8cmVmZXJlbmNlIHR5cGVzPVwiZW1zY3JpcHRlblwiIC8+XG5cbmltcG9ydCB7IFRyYW5zZm9ybSB9IGZyb20gJ3N0cmVhbSc7XG5pbXBvcnQgU3BlZXhXYXNtIGZyb20gJy4vc3BlZXhfd2FzbSc7XG5cbmludGVyZmFjZSBFbXNjcmlwdGVuTW9kdWxlT3B1c0VuY29kZXIgZXh0ZW5kcyBFbXNjcmlwdGVuTW9kdWxlIHtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9pbml0KG5iQ2hhbm5lbHM6IG51bWJlciwgaW5SYXRlOiBudW1iZXIsIG91dFJhdGU6IG51bWJlciwgcXVhbGl0eTogbnVtYmVyLCBlcnJQb2ludGVyOiBudW1iZXIpOiBudW1iZXI7XG4gIF9zcGVleF9yZXNhbXBsZXJfZGVzdHJveShyZXNhbXBsZXJQdHI6IG51bWJlcik6IHZvaWQ7XG4gIF9zcGVleF9yZXNhbXBsZXJfZ2V0X3JhdGUocmVzYW1wbGVyUHRyOiBudW1iZXIsIGluUmF0ZVB0cjogbnVtYmVyLCBvdXRSYXRlUHRyOiBudW1iZXIpO1xuICBfc3BlZXhfcmVzYW1wbGVyX3Byb2Nlc3NfaW50ZXJsZWF2ZWRfaW50KHJlc2FtcGxlclB0cjogbnVtYmVyLCBpbkJ1ZmZlclB0cjogbnVtYmVyLCBpbkxlblB0cjogbnVtYmVyLCBvdXRCdWZmZXJQdHI6IG51bWJlciwgb3V0TGVuUHRyOiBudW1iZXIpOiBudW1iZXI7XG4gIF9zcGVleF9yZXNhbXBsZXJfc3RyZXJyb3IoZXJyOiBudW1iZXIpOiBudW1iZXI7XG5cbiAgZ2V0VmFsdWUocHRyOiBudW1iZXIsIHR5cGU6IHN0cmluZyk6IGFueTtcbiAgc2V0VmFsdWUocHRyOiBudW1iZXIsIHZhbHVlOiBhbnksIHR5cGU6IHN0cmluZyk6IGFueTtcbiAgQXNjaWlUb1N0cmluZyhwdHI6IG51bWJlcik6IHN0cmluZztcbn1cblxubGV0IHNwZWV4TW9kdWxlOiBFbXNjcmlwdGVuTW9kdWxlT3B1c0VuY29kZXI7XG5sZXQgZ2xvYmFsTW9kdWxlUHJvbWlzZSA9IFNwZWV4V2FzbSgpLnRoZW4oKHMpID0+IHNwZWV4TW9kdWxlID0gcyk7XG5cbmNsYXNzIFNwZWV4UmVzYW1wbGVyIHtcbiAgX3Jlc2FtcGxlclB0cjogbnVtYmVyO1xuICBfaW5CdWZmZXJQdHIgPSAtMTtcbiAgX2luQnVmZmVyU2l6ZSA9IC0xO1xuICBfb3V0QnVmZmVyUHRyID0gLTE7XG4gIF9vdXRCdWZmZXJTaXplID0gLTE7XG5cbiAgX2luTGVuZ3RoUHRyID0gLTE7XG4gIF9vdXRMZW5ndGhQdHIgPSAtMTtcblxuICBzdGF0aWMgaW5pdFByb21pc2UgPSBnbG9iYWxNb2R1bGVQcm9taXNlIGFzIFByb21pc2U8YW55PjtcblxuICAvKipcbiAgICAqIENyZWF0ZSBhbiBTcGVleFJlc2FtcGxlciB0cmFuZm9ybSBzdHJlYW0uXG4gICAgKiBAcGFyYW0gY2hhbm5lbHMgTnVtYmVyIG9mIGNoYW5uZWxzLCBtaW5pbXVtIGlzIDEsIG5vIG1heGltdW1cbiAgICAqIEBwYXJhbSBpblJhdGUgZnJlcXVlbmN5IGluIEh6IGZvciB0aGUgaW5wdXQgY2h1bmtcbiAgICAqIEBwYXJhbSBvdXRSYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIHRhcmdldCBjaHVua1xuICAgICogQHBhcmFtIHF1YWxpdHkgbnVtYmVyIGZyb20gMSB0byAxMCwgZGVmYXVsdCB0byA3LCAxIGlzIGZhc3QgYnV0IG9mIGJhZCBxdWFsaXR5LCAxMCBpcyBzbG93IGJ1dCBiZXN0IHF1YWxpdHlcbiAgICAqL1xuICBjb25zdHJ1Y3RvcihcbiAgICBwdWJsaWMgY2hhbm5lbHMsXG4gICAgcHVibGljIGluUmF0ZSxcbiAgICBwdWJsaWMgb3V0UmF0ZSxcbiAgICBwdWJsaWMgcXVhbGl0eSA9IDcpIHt9XG5cbiAgLyoqXG4gICAgKiBSZXNhbXBsZSBhIGNodW5rIG9mIGF1ZGlvLlxuICAgICogQHBhcmFtIGNodW5rIGludGVybGVhdmVkIFBDTSBkYXRhIGluIHNpZ25lZCAxNmJpdHMgaW50XG4gICAgKi9cbiAgcHJvY2Vzc0NodW5rKGNodW5rOiBCdWZmZXIpIHtcbiAgICBpZiAoIXNwZWV4TW9kdWxlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1lvdSBuZWVkIHRvIHdhaXQgZm9yIFNwZWV4UmVzYW1wbGVyLmluaXRQcm9taXNlIGJlZm9yZSBjYWxsaW5nIHRoaXMgbWV0aG9kJyk7XG4gICAgfVxuICAgIC8vIFdlIGNoZWNrIHRoYXQgd2UgaGF2ZSBhcyBtYW55IGNodW5rcyBmb3IgZWFjaCBjaGFubmVsIGFuZCB0aGF0IHRoZSBsYXN0IGNodW5rIGlzIGZ1bGwgKDIgYnl0ZXMpXG4gICAgaWYgKGNodW5rLmxlbmd0aCAlICh0aGlzLmNoYW5uZWxzICogVWludDE2QXJyYXkuQllURVNfUEVSX0VMRU1FTlQpICE9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NodW5rIGxlbmd0aCBzaG91bGQgYmUgYSBtdWx0aXBsZSBvZiBjaGFubmVscyAqIDIgYnl0ZXMnKTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuX3Jlc2FtcGxlclB0cikge1xuICAgICAgY29uc3QgZXJyUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyg0KTtcbiAgICAgIHRoaXMuX3Jlc2FtcGxlclB0ciA9IHNwZWV4TW9kdWxlLl9zcGVleF9yZXNhbXBsZXJfaW5pdCh0aGlzLmNoYW5uZWxzLCB0aGlzLmluUmF0ZSwgdGhpcy5vdXRSYXRlLCB0aGlzLnF1YWxpdHksIGVyclB0cik7XG4gICAgICBjb25zdCBlcnJOdW0gPSBzcGVleE1vZHVsZS5nZXRWYWx1ZShlcnJQdHIsICdpMzInKTtcbiAgICAgIGlmIChlcnJOdW0gIT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKHNwZWV4TW9kdWxlLkFzY2lpVG9TdHJpbmcoc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnJOdW0pKSk7XG4gICAgICB9XG4gICAgICB0aGlzLl9pbkxlbmd0aFB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoVWludDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQpO1xuICAgICAgdGhpcy5fb3V0TGVuZ3RoUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyhVaW50MzJBcnJheS5CWVRFU19QRVJfRUxFTUVOVCk7XG4gICAgfVxuXG4gICAgLy8gUmVzaXppbmcgdGhlIGlucHV0IGJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2UgdG8gbWF0Y2ggd2hhdCB3ZSBuZWVkXG4gICAgaWYgKHRoaXMuX2luQnVmZmVyU2l6ZSA8IGNodW5rLmxlbmd0aCkge1xuICAgICAgaWYgKHRoaXMuX2luQnVmZmVyUHRyICE9PSAtMSkge1xuICAgICAgICBzcGVleE1vZHVsZS5fZnJlZSh0aGlzLl9pbkJ1ZmZlclB0cik7XG4gICAgICB9XG4gICAgICB0aGlzLl9pbkJ1ZmZlclB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoY2h1bmsubGVuZ3RoKTtcbiAgICAgIHRoaXMuX2luQnVmZmVyU2l6ZSA9IGNodW5rLmxlbmd0aDtcbiAgICB9XG5cbiAgICAvLyBSZXNpemluZyB0aGUgb3V0cHV0IGJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2UgdG8gbWF0Y2ggd2hhdCB3ZSBuZWVkXG4gICAgY29uc3Qgb3V0QnVmZmVyTGVuZ3RoVGFyZ2V0ID0gTWF0aC5jZWlsKGNodW5rLmxlbmd0aCAqIHRoaXMub3V0UmF0ZSAvIHRoaXMuaW5SYXRlKTtcbiAgICBpZiAodGhpcy5fb3V0QnVmZmVyU2l6ZSA8IG91dEJ1ZmZlckxlbmd0aFRhcmdldCkge1xuICAgICAgaWYgKHRoaXMuX291dEJ1ZmZlclB0ciAhPT0gLTEpIHtcbiAgICAgICAgc3BlZXhNb2R1bGUuX2ZyZWUodGhpcy5fb3V0QnVmZmVyUHRyKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX291dEJ1ZmZlclB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2Mob3V0QnVmZmVyTGVuZ3RoVGFyZ2V0KTtcbiAgICAgIHRoaXMuX291dEJ1ZmZlclNpemUgPSBvdXRCdWZmZXJMZW5ndGhUYXJnZXQ7XG4gICAgfVxuXG4gICAgLy8gbnVtYmVyIG9mIHNhbXBsZXMgcGVyIGNoYW5uZWwgaW4gaW5wdXQgYnVmZmVyXG4gICAgc3BlZXhNb2R1bGUuc2V0VmFsdWUodGhpcy5faW5MZW5ndGhQdHIsIGNodW5rLmxlbmd0aCAvIHRoaXMuY2hhbm5lbHMgLyBVaW50MTZBcnJheS5CWVRFU19QRVJfRUxFTUVOVCwgJ2kzMicpO1xuICAgIC8vIENvcHlpbmcgdGhlIGluZm8gZnJvbSB0aGUgaW5wdXQgQnVmZmVyIGluIHRoZSBXQVNNIG1lbW9yeSBzcGFjZVxuICAgIHNwZWV4TW9kdWxlLkhFQVBVOC5zZXQoY2h1bmssIHRoaXMuX2luQnVmZmVyUHRyKTtcblxuICAgIC8vIG51bWJlciBvZiBzYW1wbGVzIHBlciBjaGFubmVscyBhdmFpbGFibGUgaW4gb3V0cHV0IGJ1ZmZlclxuICAgIHNwZWV4TW9kdWxlLnNldFZhbHVlKHRoaXMuX291dExlbmd0aFB0ciwgdGhpcy5fb3V0QnVmZmVyU2l6ZSAvIHRoaXMuY2hhbm5lbHMgLyBVaW50MTZBcnJheS5CWVRFU19QRVJfRUxFTUVOVCwgJ2kzMicpO1xuICAgIGNvbnN0IGVyck51bSA9IHNwZWV4TW9kdWxlLl9zcGVleF9yZXNhbXBsZXJfcHJvY2Vzc19pbnRlcmxlYXZlZF9pbnQoXG4gICAgICB0aGlzLl9yZXNhbXBsZXJQdHIsXG4gICAgICB0aGlzLl9pbkJ1ZmZlclB0cixcbiAgICAgIHRoaXMuX2luTGVuZ3RoUHRyLFxuICAgICAgdGhpcy5fb3V0QnVmZmVyUHRyLFxuICAgICAgdGhpcy5fb3V0TGVuZ3RoUHRyLFxuICAgICk7XG5cbiAgICBpZiAoZXJyTnVtICE9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3Ioc3BlZXhNb2R1bGUuQXNjaWlUb1N0cmluZyhzcGVleE1vZHVsZS5fc3BlZXhfcmVzYW1wbGVyX3N0cmVycm9yKGVyck51bSkpKTtcbiAgICB9XG5cbiAgICBjb25zdCBvdXRTYW1wbGVzUGVyQ2hhbm5lbHNXcml0dGVuID0gc3BlZXhNb2R1bGUuZ2V0VmFsdWUodGhpcy5fb3V0TGVuZ3RoUHRyLCAnaTMyJyk7XG5cbiAgICAvLyB3ZSBhcmUgY29weWluZyB0aGUgaW5mbyBpbiBhIG5ldyBidWZmZXIgaGVyZSwgd2UgY291bGQganVzdCBwYXNzIGEgYnVmZmVyIHBvaW50aW5nIHRvIHRoZSBzYW1lIG1lbW9yeSBzcGFjZSBpZiBuZWVkZWRcbiAgICByZXR1cm4gQnVmZmVyLmZyb20oXG4gICAgICBzcGVleE1vZHVsZS5IRUFQVTguc3ViYXJyYXkoXG4gICAgICAgIHRoaXMuX291dEJ1ZmZlclB0cixcbiAgICAgICAgdGhpcy5fb3V0QnVmZmVyUHRyICsgb3V0U2FtcGxlc1BlckNoYW5uZWxzV3JpdHRlbiAqIHRoaXMuY2hhbm5lbHMgKiBVaW50MTZBcnJheS5CWVRFU19QRVJfRUxFTUVOVFxuICAgICAgKSk7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVGRkVSID0gQnVmZmVyLmFsbG9jKDApO1xuXG5leHBvcnQgY2xhc3MgU3BlZXhSZXNhbXBsZXJUcmFuc2Zvcm0gZXh0ZW5kcyBUcmFuc2Zvcm0ge1xuICByZXNhbXBsZXI6IFNwZWV4UmVzYW1wbGVyO1xuICBfYWxpZ25lbWVudEJ1ZmZlcjogQnVmZmVyO1xuXG4gIC8qKlxuICAgICogQ3JlYXRlIGFuIFNwZWV4UmVzYW1wbGVyIGluc3RhbmNlLlxuICAgICogQHBhcmFtIGNoYW5uZWxzIE51bWJlciBvZiBjaGFubmVscywgbWluaW11bSBpcyAxLCBubyBtYXhpbXVtXG4gICAgKiBAcGFyYW0gaW5SYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIGlucHV0IGNodW5rXG4gICAgKiBAcGFyYW0gb3V0UmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSB0YXJnZXQgY2h1bmtcbiAgICAqIEBwYXJhbSBxdWFsaXR5IG51bWJlciBmcm9tIDEgdG8gMTAsIGRlZmF1bHQgdG8gNywgMSBpcyBmYXN0IGJ1dCBvZiBiYWQgcXVhbGl0eSwgMTAgaXMgc2xvdyBidXQgYmVzdCBxdWFsaXR5XG4gICAgKi9cbiAgY29uc3RydWN0b3IocHVibGljIGNoYW5uZWxzLCBwdWJsaWMgaW5SYXRlLCBwdWJsaWMgb3V0UmF0ZSwgcHVibGljIHF1YWxpdHkgPSA3KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc2FtcGxlciA9IG5ldyBTcGVleFJlc2FtcGxlcihjaGFubmVscywgaW5SYXRlLCBvdXRSYXRlLCBxdWFsaXR5KTtcbiAgICB0aGlzLmNoYW5uZWxzID0gY2hhbm5lbHM7XG4gICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlciA9IEVNUFRZX0JVRkZFUjtcbiAgfVxuXG4gIF90cmFuc2Zvcm0oY2h1bmssIGVuY29kaW5nLCBjYWxsYmFjaykge1xuICAgIGxldCBjaHVua1RvUHJvY2VzczogQnVmZmVyID0gY2h1bms7XG4gICAgaWYgKHRoaXMuX2FsaWduZW1lbnRCdWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBCdWZmZXIuY29uY2F0KFtcbiAgICAgICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlcixcbiAgICAgICAgY2h1bmssXG4gICAgICBdKTtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBFTVBUWV9CVUZGRVI7XG4gICAgfVxuICAgIC8vIFNwZWV4IG5lZWRzIGEgYnVmZmVyIGFsaWduZWQgdG8gMTZiaXRzIHRpbWVzIHRoZSBudW1iZXIgb2YgY2hhbm5lbHNcbiAgICAvLyBzbyB3ZSBrZWVwIHRoZSBleHRyYW5lb3VzIGJ5dGVzIGluIGEgYnVmZmVyIGZvciBuZXh0IGNodW5rXG4gICAgY29uc3QgZXh0cmFuZW91c0J5dGVzQ291bnQgPSBjaHVua1RvUHJvY2Vzcy5sZW5ndGggJSAodGhpcy5jaGFubmVscyAqIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKTtcbiAgICBpZiAoZXh0cmFuZW91c0J5dGVzQ291bnQgIT09IDApIHtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBCdWZmZXIuZnJvbShjaHVua1RvUHJvY2Vzcy5zbGljZShjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCkpO1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBjaHVua1RvUHJvY2Vzcy5zbGljZSgwLCBjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSB0aGlzLnJlc2FtcGxlci5wcm9jZXNzQ2h1bmsoY2h1bmtUb1Byb2Nlc3MpO1xuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjYWxsYmFjayhlKTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgU3BlZXhSZXNhbXBsZXI7XG4iXX0=