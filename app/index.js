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
        return Buffer.from(speexModule.HEAPU8.slice(this._outBufferPtr, this._outBufferPtr + outSamplesPerChannelsWritten * this.channels * Uint16Array.BYTES_PER_ELEMENT).buffer);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiLyIsInNvdXJjZXMiOlsiaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG9DQUFvQzs7Ozs7O0FBRXBDLG1DQUFtQztBQUNuQyw4REFBcUM7QUFjckMsSUFBSSxXQUF3QyxDQUFDO0FBQzdDLElBQUksbUJBQW1CLEdBQUcsb0JBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsV0FBVyxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBRW5FLE1BQU0sY0FBYztJQVlsQjs7Ozs7O1FBTUk7SUFDSixZQUNTLFFBQVEsRUFDUixNQUFNLEVBQ04sT0FBTyxFQUNQLFVBQVUsQ0FBQztRQUhYLGFBQVEsR0FBUixRQUFRLENBQUE7UUFDUixXQUFNLEdBQU4sTUFBTSxDQUFBO1FBQ04sWUFBTyxHQUFQLE9BQU8sQ0FBQTtRQUNQLFlBQU8sR0FBUCxPQUFPLENBQUk7UUFyQnBCLGlCQUFZLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbEIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNuQixrQkFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ25CLG1CQUFjLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFcEIsaUJBQVksR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNsQixrQkFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBZUksQ0FBQztJQUV4Qjs7O1FBR0k7SUFDSixZQUFZLENBQUMsS0FBYTtRQUN4QixJQUFJLENBQUMsV0FBVyxFQUFFO1lBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsNEVBQTRFLENBQUMsQ0FBQztTQUMvRjtRQUNELGtHQUFrRztRQUNsRyxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxHQUFHLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsRUFBRTtZQUN4RSxNQUFNLElBQUksS0FBSyxDQUFDLHlEQUF5RCxDQUFDLENBQUM7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QVcsS0FBSyxDQUFDO1FBQ25DLElBQUksSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7WUFDckMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7Z0JBQzdCLElBQUksQ0FBQyxpQkFBaUI7Z0JBQ3RCLEtBQUs7YUFDTixDQUFDLENBQUM7WUFDSCxJQUFJLENBQUMsaUJBQWlCLEdBQUcsWUFBWSxDQUFDO1NBQ3ZDO1FBQ0Qsc0VBQXNFO1FBQ3RFLDZEQUE2RDtRQUM3RCxNQUFNLG9CQUFvQixHQUFHLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxHQUFHLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBQ3JHLElBQUksb0JBQW9CLEtBQUssQ0FBQyxFQUFFO1lBQzlCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLE1BQU0sR0FBRyxvQkFBb0IsQ0FBQyxDQUFDLENBQUM7WUFDekcsY0FBYyxHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLGNBQWMsQ0FBQyxNQUFNLEdBQUcsb0JBQW9CLENBQUMsQ0FBQztTQUN4RjtRQUNELElBQUk7WUFDRixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxjQUFjLENBQUMsQ0FBQztZQUN4RCxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1NBQ3JCO1FBQUMsT0FBTyxDQUFDLEVBQUU7WUFDVixRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDYjtJQUNILENBQUM7Q0FDRjtBQXpDRCwwREF5Q0M7QUFFRCxrQkFBZSxjQUFjLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLy8gPHJlZmVyZW5jZSB0eXBlcz1cImVtc2NyaXB0ZW5cIiAvPlxuXG5pbXBvcnQgeyBUcmFuc2Zvcm0gfSBmcm9tICdzdHJlYW0nO1xuaW1wb3J0IFNwZWV4V2FzbSBmcm9tICcuL3NwZWV4X3dhc20nO1xuXG5pbnRlcmZhY2UgRW1zY3JpcHRlbk1vZHVsZU9wdXNFbmNvZGVyIGV4dGVuZHMgRW1zY3JpcHRlbk1vZHVsZSB7XG4gIF9zcGVleF9yZXNhbXBsZXJfaW5pdChuYkNoYW5uZWxzOiBudW1iZXIsIGluUmF0ZTogbnVtYmVyLCBvdXRSYXRlOiBudW1iZXIsIHF1YWxpdHk6IG51bWJlciwgZXJyUG9pbnRlcjogbnVtYmVyKTogbnVtYmVyO1xuICBfc3BlZXhfcmVzYW1wbGVyX2Rlc3Ryb3kocmVzYW1wbGVyUHRyOiBudW1iZXIpOiB2b2lkO1xuICBfc3BlZXhfcmVzYW1wbGVyX2dldF9yYXRlKHJlc2FtcGxlclB0cjogbnVtYmVyLCBpblJhdGVQdHI6IG51bWJlciwgb3V0UmF0ZVB0cjogbnVtYmVyKTtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9wcm9jZXNzX2ludGVybGVhdmVkX2ludChyZXNhbXBsZXJQdHI6IG51bWJlciwgaW5CdWZmZXJQdHI6IG51bWJlciwgaW5MZW5QdHI6IG51bWJlciwgb3V0QnVmZmVyUHRyOiBudW1iZXIsIG91dExlblB0cjogbnVtYmVyKTogbnVtYmVyO1xuICBfc3BlZXhfcmVzYW1wbGVyX3N0cmVycm9yKGVycjogbnVtYmVyKTogbnVtYmVyO1xuXG4gIGdldFZhbHVlKHB0cjogbnVtYmVyLCB0eXBlOiBzdHJpbmcpOiBhbnk7XG4gIHNldFZhbHVlKHB0cjogbnVtYmVyLCB2YWx1ZTogYW55LCB0eXBlOiBzdHJpbmcpOiBhbnk7XG4gIEFzY2lpVG9TdHJpbmcocHRyOiBudW1iZXIpOiBzdHJpbmc7XG59XG5cbmxldCBzcGVleE1vZHVsZTogRW1zY3JpcHRlbk1vZHVsZU9wdXNFbmNvZGVyO1xubGV0IGdsb2JhbE1vZHVsZVByb21pc2UgPSBTcGVleFdhc20oKS50aGVuKChzKSA9PiBzcGVleE1vZHVsZSA9IHMpO1xuXG5jbGFzcyBTcGVleFJlc2FtcGxlciB7XG4gIF9yZXNhbXBsZXJQdHI6IG51bWJlcjtcbiAgX2luQnVmZmVyUHRyID0gLTE7XG4gIF9pbkJ1ZmZlclNpemUgPSAtMTtcbiAgX291dEJ1ZmZlclB0ciA9IC0xO1xuICBfb3V0QnVmZmVyU2l6ZSA9IC0xO1xuXG4gIF9pbkxlbmd0aFB0ciA9IC0xO1xuICBfb3V0TGVuZ3RoUHRyID0gLTE7XG5cbiAgc3RhdGljIGluaXRQcm9taXNlID0gZ2xvYmFsTW9kdWxlUHJvbWlzZSBhcyBQcm9taXNlPGFueT47XG5cbiAgLyoqXG4gICAgKiBDcmVhdGUgYW4gU3BlZXhSZXNhbXBsZXIgdHJhbmZvcm0gc3RyZWFtLlxuICAgICogQHBhcmFtIGNoYW5uZWxzIE51bWJlciBvZiBjaGFubmVscywgbWluaW11bSBpcyAxLCBubyBtYXhpbXVtXG4gICAgKiBAcGFyYW0gaW5SYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIGlucHV0IGNodW5rXG4gICAgKiBAcGFyYW0gb3V0UmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSB0YXJnZXQgY2h1bmtcbiAgICAqIEBwYXJhbSBxdWFsaXR5IG51bWJlciBmcm9tIDEgdG8gMTAsIGRlZmF1bHQgdG8gNywgMSBpcyBmYXN0IGJ1dCBvZiBiYWQgcXVhbGl0eSwgMTAgaXMgc2xvdyBidXQgYmVzdCBxdWFsaXR5XG4gICAgKi9cbiAgY29uc3RydWN0b3IoXG4gICAgcHVibGljIGNoYW5uZWxzLFxuICAgIHB1YmxpYyBpblJhdGUsXG4gICAgcHVibGljIG91dFJhdGUsXG4gICAgcHVibGljIHF1YWxpdHkgPSA3KSB7fVxuXG4gIC8qKlxuICAgICogUmVzYW1wbGUgYSBjaHVuayBvZiBhdWRpby5cbiAgICAqIEBwYXJhbSBjaHVuayBpbnRlcmxlYXZlZCBQQ00gZGF0YSBpbiBzaWduZWQgMTZiaXRzIGludFxuICAgICovXG4gIHByb2Nlc3NDaHVuayhjaHVuazogQnVmZmVyKSB7XG4gICAgaWYgKCFzcGVleE1vZHVsZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdZb3UgbmVlZCB0byB3YWl0IGZvciBTcGVleFJlc2FtcGxlci5pbml0UHJvbWlzZSBiZWZvcmUgY2FsbGluZyB0aGlzIG1ldGhvZCcpO1xuICAgIH1cbiAgICAvLyBXZSBjaGVjayB0aGF0IHdlIGhhdmUgYXMgbWFueSBjaHVua3MgZm9yIGVhY2ggY2hhbm5lbCBhbmQgdGhhdCB0aGUgbGFzdCBjaHVuayBpcyBmdWxsICgyIGJ5dGVzKVxuICAgIGlmIChjaHVuay5sZW5ndGggJSAodGhpcy5jaGFubmVscyAqIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKSAhPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDaHVuayBsZW5ndGggc2hvdWxkIGJlIGEgbXVsdGlwbGUgb2YgY2hhbm5lbHMgKiAyIGJ5dGVzJyk7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9yZXNhbXBsZXJQdHIpIHtcbiAgICAgIGNvbnN0IGVyclB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoNCk7XG4gICAgICB0aGlzLl9yZXNhbXBsZXJQdHIgPSBzcGVleE1vZHVsZS5fc3BlZXhfcmVzYW1wbGVyX2luaXQodGhpcy5jaGFubmVscywgdGhpcy5pblJhdGUsIHRoaXMub3V0UmF0ZSwgdGhpcy5xdWFsaXR5LCBlcnJQdHIpO1xuICAgICAgY29uc3QgZXJyTnVtID0gc3BlZXhNb2R1bGUuZ2V0VmFsdWUoZXJyUHRyLCAnaTMyJyk7XG4gICAgICBpZiAoZXJyTnVtICE9PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihzcGVleE1vZHVsZS5Bc2NpaVRvU3RyaW5nKHNwZWV4TW9kdWxlLl9zcGVleF9yZXNhbXBsZXJfc3RyZXJyb3IoZXJyTnVtKSkpO1xuICAgICAgfVxuICAgICAgdGhpcy5faW5MZW5ndGhQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKFVpbnQzMkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKTtcbiAgICAgIHRoaXMuX291dExlbmd0aFB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoVWludDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQpO1xuICAgIH1cblxuICAgIC8vIFJlc2l6aW5nIHRoZSBpbnB1dCBidWZmZXIgaW4gdGhlIFdBU00gbWVtb3J5IHNwYWNlIHRvIG1hdGNoIHdoYXQgd2UgbmVlZFxuICAgIGlmICh0aGlzLl9pbkJ1ZmZlclNpemUgPCBjaHVuay5sZW5ndGgpIHtcbiAgICAgIGlmICh0aGlzLl9pbkJ1ZmZlclB0ciAhPT0gLTEpIHtcbiAgICAgICAgc3BlZXhNb2R1bGUuX2ZyZWUodGhpcy5faW5CdWZmZXJQdHIpO1xuICAgICAgfVxuICAgICAgdGhpcy5faW5CdWZmZXJQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKGNodW5rLmxlbmd0aCk7XG4gICAgICB0aGlzLl9pbkJ1ZmZlclNpemUgPSBjaHVuay5sZW5ndGg7XG4gICAgfVxuXG4gICAgLy8gUmVzaXppbmcgdGhlIG91dHB1dCBidWZmZXIgaW4gdGhlIFdBU00gbWVtb3J5IHNwYWNlIHRvIG1hdGNoIHdoYXQgd2UgbmVlZFxuICAgIGNvbnN0IG91dEJ1ZmZlckxlbmd0aFRhcmdldCA9IE1hdGguY2VpbChjaHVuay5sZW5ndGggKiB0aGlzLm91dFJhdGUgLyB0aGlzLmluUmF0ZSk7XG4gICAgaWYgKHRoaXMuX291dEJ1ZmZlclNpemUgPCBvdXRCdWZmZXJMZW5ndGhUYXJnZXQpIHtcbiAgICAgIGlmICh0aGlzLl9vdXRCdWZmZXJQdHIgIT09IC0xKSB7XG4gICAgICAgIHNwZWV4TW9kdWxlLl9mcmVlKHRoaXMuX291dEJ1ZmZlclB0cik7XG4gICAgICB9XG4gICAgICB0aGlzLl9vdXRCdWZmZXJQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKG91dEJ1ZmZlckxlbmd0aFRhcmdldCk7XG4gICAgICB0aGlzLl9vdXRCdWZmZXJTaXplID0gb3V0QnVmZmVyTGVuZ3RoVGFyZ2V0O1xuICAgIH1cblxuICAgIC8vIG51bWJlciBvZiBzYW1wbGVzIHBlciBjaGFubmVsIGluIGlucHV0IGJ1ZmZlclxuICAgIHNwZWV4TW9kdWxlLnNldFZhbHVlKHRoaXMuX2luTGVuZ3RoUHRyLCBjaHVuay5sZW5ndGggLyB0aGlzLmNoYW5uZWxzIC8gVWludDE2QXJyYXkuQllURVNfUEVSX0VMRU1FTlQsICdpMzInKTtcbiAgICAvLyBDb3B5aW5nIHRoZSBpbmZvIGZyb20gdGhlIGlucHV0IEJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2VcbiAgICBzcGVleE1vZHVsZS5IRUFQVTguc2V0KGNodW5rLCB0aGlzLl9pbkJ1ZmZlclB0cik7XG5cbiAgICAvLyBudW1iZXIgb2Ygc2FtcGxlcyBwZXIgY2hhbm5lbHMgYXZhaWxhYmxlIGluIG91dHB1dCBidWZmZXJcbiAgICBzcGVleE1vZHVsZS5zZXRWYWx1ZSh0aGlzLl9vdXRMZW5ndGhQdHIsIHRoaXMuX291dEJ1ZmZlclNpemUgLyB0aGlzLmNoYW5uZWxzIC8gVWludDE2QXJyYXkuQllURVNfUEVSX0VMRU1FTlQsICdpMzInKTtcbiAgICBjb25zdCBlcnJOdW0gPSBzcGVleE1vZHVsZS5fc3BlZXhfcmVzYW1wbGVyX3Byb2Nlc3NfaW50ZXJsZWF2ZWRfaW50KFxuICAgICAgdGhpcy5fcmVzYW1wbGVyUHRyLFxuICAgICAgdGhpcy5faW5CdWZmZXJQdHIsXG4gICAgICB0aGlzLl9pbkxlbmd0aFB0cixcbiAgICAgIHRoaXMuX291dEJ1ZmZlclB0cixcbiAgICAgIHRoaXMuX291dExlbmd0aFB0cixcbiAgICApO1xuXG4gICAgaWYgKGVyck51bSAhPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHNwZWV4TW9kdWxlLkFzY2lpVG9TdHJpbmcoc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnJOdW0pKSk7XG4gICAgfVxuXG4gICAgY29uc3Qgb3V0U2FtcGxlc1BlckNoYW5uZWxzV3JpdHRlbiA9IHNwZWV4TW9kdWxlLmdldFZhbHVlKHRoaXMuX291dExlbmd0aFB0ciwgJ2kzMicpO1xuXG4gICAgLy8gd2UgYXJlIGNvcHlpbmcgdGhlIGluZm8gaW4gYSBuZXcgYnVmZmVyIGhlcmUsIHdlIGNvdWxkIGp1c3QgcGFzcyBhIGJ1ZmZlciBwb2ludGluZyB0byB0aGUgc2FtZSBtZW1vcnkgc3BhY2UgaWYgbmVlZGVkXG4gICAgcmV0dXJuIEJ1ZmZlci5mcm9tKFxuICAgICAgc3BlZXhNb2R1bGUuSEVBUFU4LnNsaWNlKFxuICAgICAgICB0aGlzLl9vdXRCdWZmZXJQdHIsXG4gICAgICAgIHRoaXMuX291dEJ1ZmZlclB0ciArIG91dFNhbXBsZXNQZXJDaGFubmVsc1dyaXR0ZW4gKiB0aGlzLmNoYW5uZWxzICogVWludDE2QXJyYXkuQllURVNfUEVSX0VMRU1FTlRcbiAgICAgICkuYnVmZmVyKTtcbiAgfVxufVxuXG5jb25zdCBFTVBUWV9CVUZGRVIgPSBCdWZmZXIuYWxsb2MoMCk7XG5cbmV4cG9ydCBjbGFzcyBTcGVleFJlc2FtcGxlclRyYW5zZm9ybSBleHRlbmRzIFRyYW5zZm9ybSB7XG4gIHJlc2FtcGxlcjogU3BlZXhSZXNhbXBsZXI7XG4gIF9hbGlnbmVtZW50QnVmZmVyOiBCdWZmZXI7XG5cbiAgLyoqXG4gICAgKiBDcmVhdGUgYW4gU3BlZXhSZXNhbXBsZXIgaW5zdGFuY2UuXG4gICAgKiBAcGFyYW0gY2hhbm5lbHMgTnVtYmVyIG9mIGNoYW5uZWxzLCBtaW5pbXVtIGlzIDEsIG5vIG1heGltdW1cbiAgICAqIEBwYXJhbSBpblJhdGUgZnJlcXVlbmN5IGluIEh6IGZvciB0aGUgaW5wdXQgY2h1bmtcbiAgICAqIEBwYXJhbSBvdXRSYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIHRhcmdldCBjaHVua1xuICAgICogQHBhcmFtIHF1YWxpdHkgbnVtYmVyIGZyb20gMSB0byAxMCwgZGVmYXVsdCB0byA3LCAxIGlzIGZhc3QgYnV0IG9mIGJhZCBxdWFsaXR5LCAxMCBpcyBzbG93IGJ1dCBiZXN0IHF1YWxpdHlcbiAgICAqL1xuICBjb25zdHJ1Y3RvcihwdWJsaWMgY2hhbm5lbHMsIHB1YmxpYyBpblJhdGUsIHB1YmxpYyBvdXRSYXRlLCBwdWJsaWMgcXVhbGl0eSA9IDcpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVzYW1wbGVyID0gbmV3IFNwZWV4UmVzYW1wbGVyKGNoYW5uZWxzLCBpblJhdGUsIG91dFJhdGUsIHF1YWxpdHkpO1xuICAgIHRoaXMuY2hhbm5lbHMgPSBjaGFubmVscztcbiAgICB0aGlzLl9hbGlnbmVtZW50QnVmZmVyID0gRU1QVFlfQlVGRkVSO1xuICB9XG5cbiAgX3RyYW5zZm9ybShjaHVuaywgZW5jb2RpbmcsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGNodW5rVG9Qcm9jZXNzOiBCdWZmZXIgPSBjaHVuaztcbiAgICBpZiAodGhpcy5fYWxpZ25lbWVudEJ1ZmZlci5sZW5ndGggPiAwKSB7XG4gICAgICBjaHVua1RvUHJvY2VzcyA9IEJ1ZmZlci5jb25jYXQoW1xuICAgICAgICB0aGlzLl9hbGlnbmVtZW50QnVmZmVyLFxuICAgICAgICBjaHVuayxcbiAgICAgIF0pO1xuICAgICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlciA9IEVNUFRZX0JVRkZFUjtcbiAgICB9XG4gICAgLy8gU3BlZXggbmVlZHMgYSBidWZmZXIgYWxpZ25lZCB0byAxNmJpdHMgdGltZXMgdGhlIG51bWJlciBvZiBjaGFubmVsc1xuICAgIC8vIHNvIHdlIGtlZXAgdGhlIGV4dHJhbmVvdXMgYnl0ZXMgaW4gYSBidWZmZXIgZm9yIG5leHQgY2h1bmtcbiAgICBjb25zdCBleHRyYW5lb3VzQnl0ZXNDb3VudCA9IGNodW5rVG9Qcm9jZXNzLmxlbmd0aCAlICh0aGlzLmNoYW5uZWxzICogVWludDE2QXJyYXkuQllURVNfUEVSX0VMRU1FTlQpO1xuICAgIGlmIChleHRyYW5lb3VzQnl0ZXNDb3VudCAhPT0gMCkge1xuICAgICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlciA9IEJ1ZmZlci5mcm9tKGNodW5rVG9Qcm9jZXNzLnNsaWNlKGNodW5rVG9Qcm9jZXNzLmxlbmd0aCAtIGV4dHJhbmVvdXNCeXRlc0NvdW50KSk7XG4gICAgICBjaHVua1RvUHJvY2VzcyA9IGNodW5rVG9Qcm9jZXNzLnNsaWNlKDAsIGNodW5rVG9Qcm9jZXNzLmxlbmd0aCAtIGV4dHJhbmVvdXNCeXRlc0NvdW50KTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcyA9IHRoaXMucmVzYW1wbGVyLnByb2Nlc3NDaHVuayhjaHVua1RvUHJvY2Vzcyk7XG4gICAgICBjYWxsYmFjayhudWxsLCByZXMpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNhbGxiYWNrKGUpO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBTcGVleFJlc2FtcGxlcjtcbiJdfQ==