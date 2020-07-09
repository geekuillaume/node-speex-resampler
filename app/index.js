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
        this._processing = false;
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
    async processChunk(chunk) {
        if (this._processing) {
            throw new Error('You can only process one chunk at a time, do not parallelize this function');
        }
        // We check that we have as many chunks for each channel and that the last chunk is full (2 bytes)
        if (chunk.length % (this.channels * 2) !== 0) {
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
        const errNum = speexModule._speex_resampler_process_interleaved_int(this._resamplerPtr, this._inBufferPtr, this._inLengthPtr, this._outBufferPtr, this._outLengthPtr);
        if (errNum !== 0) {
            throw new Error(speexModule.AsciiToString(speexModule._speex_resampler_strerror(errNum)));
        }
        const outSamplesPerChannelsWritten = speexModule.getValue(this._outLengthPtr, 'i32');
        this._processing = false;
        // we are copying the info in a new buffer here, we could just pass a buffer pointing to the same memory space if needed
        return Buffer.from(speexModule.HEAPU8.subarray(this._outBufferPtr, this._outBufferPtr + outSamplesPerChannelsWritten * this.channels * Uint16Array.BYTES_PER_ELEMENT));
    }
}
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
        }
        catch (e) {
            callback(e);
        }
    }
}
exports.SpeexResamplerTransform = SpeexResamplerTransform;
exports.default = SpeexResampler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiLyIsInNvdXJjZXMiOlsiaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG9DQUFvQzs7Ozs7O0FBRXBDLG1DQUFtQztBQUNuQyw4REFBcUM7QUFjckMsSUFBSSxXQUF3QyxDQUFDO0FBQzdDLElBQUksbUJBQW1CLEdBQUcsb0JBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsV0FBVyxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBRW5FLE1BQU0sY0FBYztJQVdsQjs7Ozs7O1FBTUk7SUFDSixZQUNTLFFBQVEsRUFDUixNQUFNLEVBQ04sT0FBTyxFQUNQLFVBQVUsQ0FBQztRQUhYLGFBQVEsR0FBUixRQUFRLENBQUE7UUFDUixXQUFNLEdBQU4sTUFBTSxDQUFBO1FBQ04sWUFBTyxHQUFQLE9BQU8sQ0FBQTtRQUNQLFlBQU8sR0FBUCxPQUFPLENBQUk7UUFyQnBCLGdCQUFXLEdBQUcsS0FBSyxDQUFDO1FBRXBCLGlCQUFZLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbEIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNuQixrQkFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ25CLG1CQUFjLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFcEIsaUJBQVksR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNsQixrQkFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBYUksQ0FBQztJQUV4Qjs7O1FBR0k7SUFDSixLQUFLLENBQUMsWUFBWSxDQUFDLEtBQWE7UUFDOUIsSUFBSSxJQUFJLENBQUMsV0FBVyxFQUFFO1lBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMsNEVBQTRFLENBQUMsQ0FBQztTQUMvRjtRQUNELGtHQUFrRztRQUNsRyxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBRTtZQUM1QyxNQUFNLElB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QUE1Q0QsMERBNENDO0FBRUQsa0JBQWUsY0FBYyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8vIDxyZWZlcmVuY2UgdHlwZXM9XCJlbXNjcmlwdGVuXCIgLz5cblxuaW1wb3J0IHsgVHJhbnNmb3JtIH0gZnJvbSAnc3RyZWFtJztcbmltcG9ydCBTcGVleFdhc20gZnJvbSAnLi9zcGVleF93YXNtJztcblxuaW50ZXJmYWNlIEVtc2NyaXB0ZW5Nb2R1bGVPcHVzRW5jb2RlciBleHRlbmRzIEVtc2NyaXB0ZW5Nb2R1bGUge1xuICBfc3BlZXhfcmVzYW1wbGVyX2luaXQobmJDaGFubmVsczogbnVtYmVyLCBpblJhdGU6IG51bWJlciwgb3V0UmF0ZTogbnVtYmVyLCBxdWFsaXR5OiBudW1iZXIsIGVyclBvaW50ZXI6IG51bWJlcik6IG51bWJlcjtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9kZXN0cm95KHJlc2FtcGxlclB0cjogbnVtYmVyKTogdm9pZDtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9nZXRfcmF0ZShyZXNhbXBsZXJQdHI6IG51bWJlciwgaW5SYXRlUHRyOiBudW1iZXIsIG91dFJhdGVQdHI6IG51bWJlcik7XG4gIF9zcGVleF9yZXNhbXBsZXJfcHJvY2Vzc19pbnRlcmxlYXZlZF9pbnQocmVzYW1wbGVyUHRyOiBudW1iZXIsIGluQnVmZmVyUHRyOiBudW1iZXIsIGluTGVuUHRyOiBudW1iZXIsIG91dEJ1ZmZlclB0cjogbnVtYmVyLCBvdXRMZW5QdHI6IG51bWJlcik6IG51bWJlcjtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnI6IG51bWJlcik6IG51bWJlcjtcblxuICBnZXRWYWx1ZShwdHI6IG51bWJlciwgdHlwZTogc3RyaW5nKTogYW55O1xuICBzZXRWYWx1ZShwdHI6IG51bWJlciwgdmFsdWU6IGFueSwgdHlwZTogc3RyaW5nKTogYW55O1xuICBBc2NpaVRvU3RyaW5nKHB0cjogbnVtYmVyKTogc3RyaW5nO1xufVxuXG5sZXQgc3BlZXhNb2R1bGU6IEVtc2NyaXB0ZW5Nb2R1bGVPcHVzRW5jb2RlcjtcbmxldCBnbG9iYWxNb2R1bGVQcm9taXNlID0gU3BlZXhXYXNtKCkudGhlbigocykgPT4gc3BlZXhNb2R1bGUgPSBzKTtcblxuY2xhc3MgU3BlZXhSZXNhbXBsZXIge1xuICBfcHJvY2Vzc2luZyA9IGZhbHNlO1xuICBfcmVzYW1wbGVyUHRyOiBudW1iZXI7XG4gIF9pbkJ1ZmZlclB0ciA9IC0xO1xuICBfaW5CdWZmZXJTaXplID0gLTE7XG4gIF9vdXRCdWZmZXJQdHIgPSAtMTtcbiAgX291dEJ1ZmZlclNpemUgPSAtMTtcblxuICBfaW5MZW5ndGhQdHIgPSAtMTtcbiAgX291dExlbmd0aFB0ciA9IC0xO1xuXG4gIC8qKlxuICAgICogQ3JlYXRlIGFuIFNwZWV4UmVzYW1wbGVyIHRyYW5mb3JtIHN0cmVhbS5cbiAgICAqIEBwYXJhbSBjaGFubmVscyBOdW1iZXIgb2YgY2hhbm5lbHMsIG1pbmltdW0gaXMgMSwgbm8gbWF4aW11bVxuICAgICogQHBhcmFtIGluUmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSBpbnB1dCBjaHVua1xuICAgICogQHBhcmFtIG91dFJhdGUgZnJlcXVlbmN5IGluIEh6IGZvciB0aGUgdGFyZ2V0IGNodW5rXG4gICAgKiBAcGFyYW0gcXVhbGl0eSBudW1iZXIgZnJvbSAxIHRvIDEwLCBkZWZhdWx0IHRvIDcsIDEgaXMgZmFzdCBidXQgb2YgYmFkIHF1YWxpdHksIDEwIGlzIHNsb3cgYnV0IGJlc3QgcXVhbGl0eVxuICAgICovXG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyBjaGFubmVscyxcbiAgICBwdWJsaWMgaW5SYXRlLFxuICAgIHB1YmxpYyBvdXRSYXRlLFxuICAgIHB1YmxpYyBxdWFsaXR5ID0gNykge31cblxuICAvKipcbiAgICAqIFJlc2FtcGxlIGEgY2h1bmsgb2YgYXVkaW8uXG4gICAgKiBAcGFyYW0gY2h1bmsgaW50ZXJsZWF2ZWQgUENNIGRhdGEgaW4gc2lnbmVkIDE2Yml0cyBpbnRcbiAgICAqL1xuICBhc3luYyBwcm9jZXNzQ2h1bmsoY2h1bms6IEJ1ZmZlcikge1xuICAgIGlmICh0aGlzLl9wcm9jZXNzaW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1lvdSBjYW4gb25seSBwcm9jZXNzIG9uZSBjaHVuayBhdCBhIHRpbWUsIGRvIG5vdCBwYXJhbGxlbGl6ZSB0aGlzIGZ1bmN0aW9uJyk7XG4gICAgfVxuICAgIC8vIFdlIGNoZWNrIHRoYXQgd2UgaGF2ZSBhcyBtYW55IGNodW5rcyBmb3IgZWFjaCBjaGFubmVsIGFuZCB0aGF0IHRoZSBsYXN0IGNodW5rIGlzIGZ1bGwgKDIgYnl0ZXMpXG4gICAgaWYgKGNodW5rLmxlbmd0aCAlICh0aGlzLmNoYW5uZWxzICogMikgIT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2h1bmsgbGVuZ3RoIHNob3VsZCBiZSBhIG11bHRpcGxlIG9mIGNoYW5uZWxzICogMiBieXRlcycpO1xuICAgIH1cblxuICAgIHRoaXMuX3Byb2Nlc3NpbmcgPSB0cnVlO1xuICAgIGF3YWl0IGdsb2JhbE1vZHVsZVByb21pc2U7XG4gICAgaWYgKCF0aGlzLl9yZXNhbXBsZXJQdHIpIHtcbiAgICAgIGNvbnN0IGVyclB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoNCk7XG4gICAgICB0aGlzLl9yZXNhbXBsZXJQdHIgPSBzcGVleE1vZHVsZS5fc3BlZXhfcmVzYW1wbGVyX2luaXQodGhpcy5jaGFubmVscywgdGhpcy5pblJhdGUsIHRoaXMub3V0UmF0ZSwgdGhpcy5xdWFsaXR5LCBlcnJQdHIpO1xuICAgICAgY29uc3QgZXJyTnVtID0gc3BlZXhNb2R1bGUuZ2V0VmFsdWUoZXJyUHRyLCAnaTMyJyk7XG4gICAgICBpZiAoZXJyTnVtICE9PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihzcGVleE1vZHVsZS5Bc2NpaVRvU3RyaW5nKHNwZWV4TW9kdWxlLl9zcGVleF9yZXNhbXBsZXJfc3RyZXJyb3IoZXJyTnVtKSkpO1xuICAgICAgfVxuICAgICAgdGhpcy5faW5MZW5ndGhQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKFVpbnQzMkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKTtcbiAgICAgIHRoaXMuX291dExlbmd0aFB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoVWludDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQpO1xuICAgIH1cblxuICAgIC8vIFJlc2l6aW5nIHRoZSBpbnB1dCBidWZmZXIgaW4gdGhlIFdBU00gbWVtb3J5IHNwYWNlIHRvIG1hdGNoIHdoYXQgd2UgbmVlZFxuICAgIGlmICh0aGlzLl9pbkJ1ZmZlclNpemUgPCBjaHVuay5sZW5ndGgpIHtcbiAgICAgIGlmICh0aGlzLl9pbkJ1ZmZlclB0ciAhPT0gLTEpIHtcbiAgICAgICAgc3BlZXhNb2R1bGUuX2ZyZWUodGhpcy5faW5CdWZmZXJQdHIpO1xuICAgICAgfVxuICAgICAgdGhpcy5faW5CdWZmZXJQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKGNodW5rLmxlbmd0aCk7XG4gICAgICB0aGlzLl9pbkJ1ZmZlclNpemUgPSBjaHVuay5sZW5ndGg7XG4gICAgfVxuXG4gICAgLy8gUmVzaXppbmcgdGhlIG91dHB1dCBidWZmZXIgaW4gdGhlIFdBU00gbWVtb3J5IHNwYWNlIHRvIG1hdGNoIHdoYXQgd2UgbmVlZFxuICAgIGNvbnN0IG91dEJ1ZmZlckxlbmd0aFRhcmdldCA9IE1hdGguY2VpbChjaHVuay5sZW5ndGggKiB0aGlzLm91dFJhdGUgLyB0aGlzLmluUmF0ZSk7XG4gICAgaWYgKHRoaXMuX291dEJ1ZmZlclNpemUgPCBvdXRCdWZmZXJMZW5ndGhUYXJnZXQpIHtcbiAgICAgIGlmICh0aGlzLl9vdXRCdWZmZXJQdHIgIT09IC0xKSB7XG4gICAgICAgIHNwZWV4TW9kdWxlLl9mcmVlKHRoaXMuX291dEJ1ZmZlclB0cik7XG4gICAgICB9XG4gICAgICB0aGlzLl9vdXRCdWZmZXJQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKG91dEJ1ZmZlckxlbmd0aFRhcmdldCk7XG4gICAgICB0aGlzLl9vdXRCdWZmZXJTaXplID0gb3V0QnVmZmVyTGVuZ3RoVGFyZ2V0O1xuICAgIH1cblxuICAgIC8vIG51bWJlciBvZiBzYW1wbGVzIHBlciBjaGFubmVsIGluIGlucHV0IGJ1ZmZlclxuICAgIHNwZWV4TW9kdWxlLnNldFZhbHVlKHRoaXMuX2luTGVuZ3RoUHRyLCBjaHVuay5sZW5ndGggLyB0aGlzLmNoYW5uZWxzIC8gVWludDE2QXJyYXkuQllURVNfUEVSX0VMRU1FTlQsICdpMzInKTtcbiAgICAvLyBDb3B5aW5nIHRoZSBpbmZvIGZyb20gdGhlIGlucHV0IEJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2VcbiAgICBzcGVleE1vZHVsZS5IRUFQVTguc2V0KGNodW5rLCB0aGlzLl9pbkJ1ZmZlclB0cik7XG5cbiAgICAvLyBudW1iZXIgb2Ygc2FtcGxlcyBwZXIgY2hhbm5lbHMgYXZhaWxhYmxlIGluIG91dHB1dCBidWZmZXJcbiAgICBzcGVleE1vZHVsZS5zZXRWYWx1ZSh0aGlzLl9vdXRMZW5ndGhQdHIsIHRoaXMuX291dEJ1ZmZlclNpemUgLyB0aGlzLmNoYW5uZWxzIC8gVWludDE2QXJyYXkuQllURVNfUEVSX0VMRU1FTlQsICdpMzInKTtcbiAgICBjb25zdCBlcnJOdW0gPSBzcGVleE1vZHVsZS5fc3BlZXhfcmVzYW1wbGVyX3Byb2Nlc3NfaW50ZXJsZWF2ZWRfaW50KFxuICAgICAgdGhpcy5fcmVzYW1wbGVyUHRyLFxuICAgICAgdGhpcy5faW5CdWZmZXJQdHIsXG4gICAgICB0aGlzLl9pbkxlbmd0aFB0cixcbiAgICAgIHRoaXMuX291dEJ1ZmZlclB0cixcbiAgICAgIHRoaXMuX291dExlbmd0aFB0cixcbiAgICApO1xuXG4gICAgaWYgKGVyck51bSAhPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHNwZWV4TW9kdWxlLkFzY2lpVG9TdHJpbmcoc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnJOdW0pKSk7XG4gICAgfVxuXG4gICAgY29uc3Qgb3V0U2FtcGxlc1BlckNoYW5uZWxzV3JpdHRlbiA9IHNwZWV4TW9kdWxlLmdldFZhbHVlKHRoaXMuX291dExlbmd0aFB0ciwgJ2kzMicpO1xuXG4gICAgdGhpcy5fcHJvY2Vzc2luZyA9IGZhbHNlO1xuICAgIC8vIHdlIGFyZSBjb3B5aW5nIHRoZSBpbmZvIGluIGEgbmV3IGJ1ZmZlciBoZXJlLCB3ZSBjb3VsZCBqdXN0IHBhc3MgYSBidWZmZXIgcG9pbnRpbmcgdG8gdGhlIHNhbWUgbWVtb3J5IHNwYWNlIGlmIG5lZWRlZFxuICAgIHJldHVybiBCdWZmZXIuZnJvbShcbiAgICAgIHNwZWV4TW9kdWxlLkhFQVBVOC5zdWJhcnJheShcbiAgICAgICAgdGhpcy5fb3V0QnVmZmVyUHRyLFxuICAgICAgICB0aGlzLl9vdXRCdWZmZXJQdHIgKyBvdXRTYW1wbGVzUGVyQ2hhbm5lbHNXcml0dGVuICogdGhpcy5jaGFubmVscyAqIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UXG4gICAgICApKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgU3BlZXhSZXNhbXBsZXJUcmFuc2Zvcm0gZXh0ZW5kcyBUcmFuc2Zvcm0ge1xuICByZXNhbXBsZXI6IFNwZWV4UmVzYW1wbGVyO1xuICBfYWxpZ25lbWVudEJ1ZmZlcjogQnVmZmVyO1xuICBfYWxpZ25lbWVudEJ1ZmZlckxlbmd0aDogbnVtYmVyO1xuXG4gIC8qKlxuICAgICogQ3JlYXRlIGFuIFNwZWV4UmVzYW1wbGVyIGluc3RhbmNlLlxuICAgICogQHBhcmFtIGNoYW5uZWxzIE51bWJlciBvZiBjaGFubmVscywgbWluaW11bSBpcyAxLCBubyBtYXhpbXVtXG4gICAgKiBAcGFyYW0gaW5SYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIGlucHV0IGNodW5rXG4gICAgKiBAcGFyYW0gb3V0UmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSB0YXJnZXQgY2h1bmtcbiAgICAqIEBwYXJhbSBxdWFsaXR5IG51bWJlciBmcm9tIDEgdG8gMTAsIGRlZmF1bHQgdG8gNywgMSBpcyBmYXN0IGJ1dCBvZiBiYWQgcXVhbGl0eSwgMTAgaXMgc2xvdyBidXQgYmVzdCBxdWFsaXR5XG4gICAgKi9cbiAgY29uc3RydWN0b3IocHVibGljIGNoYW5uZWxzLCBwdWJsaWMgaW5SYXRlLCBwdWJsaWMgb3V0UmF0ZSwgcHVibGljIHF1YWxpdHkgPSA3KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc2FtcGxlciA9IG5ldyBTcGVleFJlc2FtcGxlcihjaGFubmVscywgaW5SYXRlLCBvdXRSYXRlLCBxdWFsaXR5KTtcbiAgICB0aGlzLmNoYW5uZWxzID0gY2hhbm5lbHM7XG4gICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlciA9IEJ1ZmZlci5hbGxvYyh0aGlzLmNoYW5uZWxzICogMik7XG4gICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlckxlbmd0aCA9IDA7XG4gIH1cblxuICBhc3luYyBfdHJhbnNmb3JtKGNodW5rLCBlbmNvZGluZywgY2FsbGJhY2spIHtcbiAgICBsZXQgY2h1bmtUb1Byb2Nlc3MgPSBjaHVuaztcbiAgICBpZiAodGhpcy5fYWxpZ25lbWVudEJ1ZmZlckxlbmd0aCA+IDApIHtcbiAgICAgIGNodW5rVG9Qcm9jZXNzID0gQnVmZmVyLmNvbmNhdChbXG4gICAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIuc3ViYXJyYXkoMCwgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlckxlbmd0aCksXG4gICAgICAgIGNodW5rLFxuICAgICAgXSk7XG4gICAgICB0aGlzLl9hbGlnbmVtZW50QnVmZmVyTGVuZ3RoID0gMDtcbiAgICB9XG4gICAgLy8gU3BlZXggbmVlZHMgYSBidWZmZXIgYWxpZ25lZCB0byAxNmJpdHMgdGltZXMgdGhlIG51bWJlciBvZiBjaGFubmVsc1xuICAgIC8vIHNvIHdlIGtlZXAgdGhlIGV4dHJhbmVvdXMgYnl0ZXMgaW4gYSBidWZmZXIgZm9yIG5leHQgY2h1bmtcbiAgICBjb25zdCBleHRyYW5lb3VzQnl0ZXNDb3VudCA9IGNodW5rVG9Qcm9jZXNzLmxlbmd0aCAlICh0aGlzLmNoYW5uZWxzICogMik7XG4gICAgaWYgKGV4dHJhbmVvdXNCeXRlc0NvdW50ICE9PSAwKSB7XG4gICAgICBjaHVua1RvUHJvY2Vzcy5jb3B5KHRoaXMuX2FsaWduZW1lbnRCdWZmZXIsIDAsIGV4dHJhbmVvdXNCeXRlc0NvdW50KTtcbiAgICAgIGNodW5rVG9Qcm9jZXNzID0gY2h1bmtUb1Byb2Nlc3Muc3ViYXJyYXkoMCwgY2h1bmtUb1Byb2Nlc3MubGVuZ3RoIC0gZXh0cmFuZW91c0J5dGVzQ291bnQpO1xuICAgICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlckxlbmd0aCA9IGV4dHJhbmVvdXNCeXRlc0NvdW50O1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5yZXNhbXBsZXIucHJvY2Vzc0NodW5rKGNodW5rVG9Qcm9jZXNzKTtcbiAgICAgIGNhbGxiYWNrKG51bGwsIHJlcyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY2FsbGJhY2soZSk7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFNwZWV4UmVzYW1wbGVyO1xuIl19
