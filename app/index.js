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
    async _transform(chunk, encoding, callback) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiLyIsInNvdXJjZXMiOlsiaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG9DQUFvQzs7Ozs7O0FBRXBDLG1DQUFtQztBQUNuQyw4REFBcUM7QUFjckMsSUFBSSxXQUF3QyxDQUFDO0FBQzdDLElBQUksbUJBQW1CLEdBQUcsb0JBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsV0FBVyxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBRW5FLE1BQU0sY0FBYztJQVdsQjs7Ozs7O1FBTUk7SUFDSixZQUNTLFFBQVEsRUFDUixNQUFNLEVBQ04sT0FBTyxFQUNQLFVBQVUsQ0FBQztRQUhYLGFBQVEsR0FBUixRQUFRLENBQUE7UUFDUixXQUFNLEdBQU4sTUFBTSxDQUFBO1FBQ04sWUFBTyxHQUFQLE9BQU8sQ0FBQTtRQUNQLFlBQU8sR0FBUCxPQUFPLENBQUk7UUFyQnBCLGdCQUFXLEdBQUcsS0FBSyxDQUFDO1FBRXBCLGlCQUFZLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbEIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNuQixrQkFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ25CLG1CQUFjLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFcEIsaUJBQVksR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNsQixrQkFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBYUksQ0FBQztJQUV4Qjs7O1FBR0k7SUFDSixLQUFLLENBQUMsWUFBWSxDQUFDLEtBQWE7UUFDOUIsSUFBSSxJQUFJLENBQUMsV0FBVyxFQUFFO1lBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMsNEVBQTRFLENBQUMsQ0FBQztTQUMvRjtRQUNELGtHQUFrRztRQUNsRyxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxHQUFHLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsRUFBRTtZ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bnRlbnQiOlsiLy8vIDxyZWZlcmVuY2UgdHlwZXM9XCJlbXNjcmlwdGVuXCIgLz5cblxuaW1wb3J0IHsgVHJhbnNmb3JtIH0gZnJvbSAnc3RyZWFtJztcbmltcG9ydCBTcGVleFdhc20gZnJvbSAnLi9zcGVleF93YXNtJztcblxuaW50ZXJmYWNlIEVtc2NyaXB0ZW5Nb2R1bGVPcHVzRW5jb2RlciBleHRlbmRzIEVtc2NyaXB0ZW5Nb2R1bGUge1xuICBfc3BlZXhfcmVzYW1wbGVyX2luaXQobmJDaGFubmVsczogbnVtYmVyLCBpblJhdGU6IG51bWJlciwgb3V0UmF0ZTogbnVtYmVyLCBxdWFsaXR5OiBudW1iZXIsIGVyclBvaW50ZXI6IG51bWJlcik6IG51bWJlcjtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9kZXN0cm95KHJlc2FtcGxlclB0cjogbnVtYmVyKTogdm9pZDtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9nZXRfcmF0ZShyZXNhbXBsZXJQdHI6IG51bWJlciwgaW5SYXRlUHRyOiBudW1iZXIsIG91dFJhdGVQdHI6IG51bWJlcik7XG4gIF9zcGVleF9yZXNhbXBsZXJfcHJvY2Vzc19pbnRlcmxlYXZlZF9pbnQocmVzYW1wbGVyUHRyOiBudW1iZXIsIGluQnVmZmVyUHRyOiBudW1iZXIsIGluTGVuUHRyOiBudW1iZXIsIG91dEJ1ZmZlclB0cjogbnVtYmVyLCBvdXRMZW5QdHI6IG51bWJlcik6IG51bWJlcjtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnI6IG51bWJlcik6IG51bWJlcjtcblxuICBnZXRWYWx1ZShwdHI6IG51bWJlciwgdHlwZTogc3RyaW5nKTogYW55O1xuICBzZXRWYWx1ZShwdHI6IG51bWJlciwgdmFsdWU6IGFueSwgdHlwZTogc3RyaW5nKTogYW55O1xuICBBc2NpaVRvU3RyaW5nKHB0cjogbnVtYmVyKTogc3RyaW5nO1xufVxuXG5sZXQgc3BlZXhNb2R1bGU6IEVtc2NyaXB0ZW5Nb2R1bGVPcHVzRW5jb2RlcjtcbmxldCBnbG9iYWxNb2R1bGVQcm9taXNlID0gU3BlZXhXYXNtKCkudGhlbigocykgPT4gc3BlZXhNb2R1bGUgPSBzKTtcblxuY2xhc3MgU3BlZXhSZXNhbXBsZXIge1xuICBfcHJvY2Vzc2luZyA9IGZhbHNlO1xuICBfcmVzYW1wbGVyUHRyOiBudW1iZXI7XG4gIF9pbkJ1ZmZlclB0ciA9IC0xO1xuICBfaW5CdWZmZXJTaXplID0gLTE7XG4gIF9vdXRCdWZmZXJQdHIgPSAtMTtcbiAgX291dEJ1ZmZlclNpemUgPSAtMTtcblxuICBfaW5MZW5ndGhQdHIgPSAtMTtcbiAgX291dExlbmd0aFB0ciA9IC0xO1xuXG4gIC8qKlxuICAgICogQ3JlYXRlIGFuIFNwZWV4UmVzYW1wbGVyIHRyYW5mb3JtIHN0cmVhbS5cbiAgICAqIEBwYXJhbSBjaGFubmVscyBOdW1iZXIgb2YgY2hhbm5lbHMsIG1pbmltdW0gaXMgMSwgbm8gbWF4aW11bVxuICAgICogQHBhcmFtIGluUmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSBpbnB1dCBjaHVua1xuICAgICogQHBhcmFtIG91dFJhdGUgZnJlcXVlbmN5IGluIEh6IGZvciB0aGUgdGFyZ2V0IGNodW5rXG4gICAgKiBAcGFyYW0gcXVhbGl0eSBudW1iZXIgZnJvbSAxIHRvIDEwLCBkZWZhdWx0IHRvIDcsIDEgaXMgZmFzdCBidXQgb2YgYmFkIHF1YWxpdHksIDEwIGlzIHNsb3cgYnV0IGJlc3QgcXVhbGl0eVxuICAgICovXG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyBjaGFubmVscyxcbiAgICBwdWJsaWMgaW5SYXRlLFxuICAgIHB1YmxpYyBvdXRSYXRlLFxuICAgIHB1YmxpYyBxdWFsaXR5ID0gNykge31cblxuICAvKipcbiAgICAqIFJlc2FtcGxlIGEgY2h1bmsgb2YgYXVkaW8uXG4gICAgKiBAcGFyYW0gY2h1bmsgaW50ZXJsZWF2ZWQgUENNIGRhdGEgaW4gc2lnbmVkIDE2Yml0cyBpbnRcbiAgICAqL1xuICBhc3luYyBwcm9jZXNzQ2h1bmsoY2h1bms6IEJ1ZmZlcikge1xuICAgIGlmICh0aGlzLl9wcm9jZXNzaW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1lvdSBjYW4gb25seSBwcm9jZXNzIG9uZSBjaHVuayBhdCBhIHRpbWUsIGRvIG5vdCBwYXJhbGxlbGl6ZSB0aGlzIGZ1bmN0aW9uJyk7XG4gICAgfVxuICAgIC8vIFdlIGNoZWNrIHRoYXQgd2UgaGF2ZSBhcyBtYW55IGNodW5rcyBmb3IgZWFjaCBjaGFubmVsIGFuZCB0aGF0IHRoZSBsYXN0IGNodW5rIGlzIGZ1bGwgKDIgYnl0ZXMpXG4gICAgaWYgKGNodW5rLmxlbmd0aCAlICh0aGlzLmNoYW5uZWxzICogVWludDE2QXJyYXkuQllURVNfUEVSX0VMRU1FTlQpICE9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NodW5rIGxlbmd0aCBzaG91bGQgYmUgYSBtdWx0aXBsZSBvZiBjaGFubmVscyAqIDIgYnl0ZXMnKTtcbiAgICB9XG5cbiAgICB0aGlzLl9wcm9jZXNzaW5nID0gdHJ1ZTtcbiAgICBhd2FpdCBnbG9iYWxNb2R1bGVQcm9taXNlO1xuICAgIGlmICghdGhpcy5fcmVzYW1wbGVyUHRyKSB7XG4gICAgICBjb25zdCBlcnJQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKDQpO1xuICAgICAgdGhpcy5fcmVzYW1wbGVyUHRyID0gc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9pbml0KHRoaXMuY2hhbm5lbHMsIHRoaXMuaW5SYXRlLCB0aGlzLm91dFJhdGUsIHRoaXMucXVhbGl0eSwgZXJyUHRyKTtcbiAgICAgIGNvbnN0IGVyck51bSA9IHNwZWV4TW9kdWxlLmdldFZhbHVlKGVyclB0ciwgJ2kzMicpO1xuICAgICAgaWYgKGVyck51bSAhPT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3Ioc3BlZXhNb2R1bGUuQXNjaWlUb1N0cmluZyhzcGVleE1vZHVsZS5fc3BlZXhfcmVzYW1wbGVyX3N0cmVycm9yKGVyck51bSkpKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX2luTGVuZ3RoUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyhVaW50MzJBcnJheS5CWVRFU19QRVJfRUxFTUVOVCk7XG4gICAgICB0aGlzLl9vdXRMZW5ndGhQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKFVpbnQzMkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKTtcbiAgICB9XG5cbiAgICAvLyBSZXNpemluZyB0aGUgaW5wdXQgYnVmZmVyIGluIHRoZSBXQVNNIG1lbW9yeSBzcGFjZSB0byBtYXRjaCB3aGF0IHdlIG5lZWRcbiAgICBpZiAodGhpcy5faW5CdWZmZXJTaXplIDwgY2h1bmsubGVuZ3RoKSB7XG4gICAgICBpZiAodGhpcy5faW5CdWZmZXJQdHIgIT09IC0xKSB7XG4gICAgICAgIHNwZWV4TW9kdWxlLl9mcmVlKHRoaXMuX2luQnVmZmVyUHRyKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX2luQnVmZmVyUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyhjaHVuay5sZW5ndGgpO1xuICAgICAgdGhpcy5faW5CdWZmZXJTaXplID0gY2h1bmsubGVuZ3RoO1xuICAgIH1cblxuICAgIC8vIFJlc2l6aW5nIHRoZSBvdXRwdXQgYnVmZmVyIGluIHRoZSBXQVNNIG1lbW9yeSBzcGFjZSB0byBtYXRjaCB3aGF0IHdlIG5lZWRcbiAgICBjb25zdCBvdXRCdWZmZXJMZW5ndGhUYXJnZXQgPSBNYXRoLmNlaWwoY2h1bmsubGVuZ3RoICogdGhpcy5vdXRSYXRlIC8gdGhpcy5pblJhdGUpO1xuICAgIGlmICh0aGlzLl9vdXRCdWZmZXJTaXplIDwgb3V0QnVmZmVyTGVuZ3RoVGFyZ2V0KSB7XG4gICAgICBpZiAodGhpcy5fb3V0QnVmZmVyUHRyICE9PSAtMSkge1xuICAgICAgICBzcGVleE1vZHVsZS5fZnJlZSh0aGlzLl9vdXRCdWZmZXJQdHIpO1xuICAgICAgfVxuICAgICAgdGhpcy5fb3V0QnVmZmVyUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyhvdXRCdWZmZXJMZW5ndGhUYXJnZXQpO1xuICAgICAgdGhpcy5fb3V0QnVmZmVyU2l6ZSA9IG91dEJ1ZmZlckxlbmd0aFRhcmdldDtcbiAgICB9XG5cbiAgICAvLyBudW1iZXIgb2Ygc2FtcGxlcyBwZXIgY2hhbm5lbCBpbiBpbnB1dCBidWZmZXJcbiAgICBzcGVleE1vZHVsZS5zZXRWYWx1ZSh0aGlzLl9pbkxlbmd0aFB0ciwgY2h1bmsubGVuZ3RoIC8gdGhpcy5jaGFubmVscyAvIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5ULCAnaTMyJyk7XG4gICAgLy8gQ29weWluZyB0aGUgaW5mbyBmcm9tIHRoZSBpbnB1dCBCdWZmZXIgaW4gdGhlIFdBU00gbWVtb3J5IHNwYWNlXG4gICAgc3BlZXhNb2R1bGUuSEVBUFU4LnNldChjaHVuaywgdGhpcy5faW5CdWZmZXJQdHIpO1xuXG4gICAgLy8gbnVtYmVyIG9mIHNhbXBsZXMgcGVyIGNoYW5uZWxzIGF2YWlsYWJsZSBpbiBvdXRwdXQgYnVmZmVyXG4gICAgc3BlZXhNb2R1bGUuc2V0VmFsdWUodGhpcy5fb3V0TGVuZ3RoUHRyLCB0aGlzLl9vdXRCdWZmZXJTaXplIC8gdGhpcy5jaGFubmVscyAvIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5ULCAnaTMyJyk7XG4gICAgY29uc3QgZXJyTnVtID0gc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9wcm9jZXNzX2ludGVybGVhdmVkX2ludChcbiAgICAgIHRoaXMuX3Jlc2FtcGxlclB0cixcbiAgICAgIHRoaXMuX2luQnVmZmVyUHRyLFxuICAgICAgdGhpcy5faW5MZW5ndGhQdHIsXG4gICAgICB0aGlzLl9vdXRCdWZmZXJQdHIsXG4gICAgICB0aGlzLl9vdXRMZW5ndGhQdHIsXG4gICAgKTtcblxuICAgIGlmIChlcnJOdW0gIT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihzcGVleE1vZHVsZS5Bc2NpaVRvU3RyaW5nKHNwZWV4TW9kdWxlLl9zcGVleF9yZXNhbXBsZXJfc3RyZXJyb3IoZXJyTnVtKSkpO1xuICAgIH1cblxuICAgIGNvbnN0IG91dFNhbXBsZXNQZXJDaGFubmVsc1dyaXR0ZW4gPSBzcGVleE1vZHVsZS5nZXRWYWx1ZSh0aGlzLl9vdXRMZW5ndGhQdHIsICdpMzInKTtcblxuICAgIHRoaXMuX3Byb2Nlc3NpbmcgPSBmYWxzZTtcbiAgICAvLyB3ZSBhcmUgY29weWluZyB0aGUgaW5mbyBpbiBhIG5ldyBidWZmZXIgaGVyZSwgd2UgY291bGQganVzdCBwYXNzIGEgYnVmZmVyIHBvaW50aW5nIHRvIHRoZSBzYW1lIG1lbW9yeSBzcGFjZSBpZiBuZWVkZWRcbiAgICByZXR1cm4gQnVmZmVyLmZyb20oXG4gICAgICBzcGVleE1vZHVsZS5IRUFQVTguc3ViYXJyYXkoXG4gICAgICAgIHRoaXMuX291dEJ1ZmZlclB0cixcbiAgICAgICAgdGhpcy5fb3V0QnVmZmVyUHRyICsgb3V0U2FtcGxlc1BlckNoYW5uZWxzV3JpdHRlbiAqIHRoaXMuY2hhbm5lbHMgKiBVaW50MTZBcnJheS5CWVRFU19QRVJfRUxFTUVOVFxuICAgICAgKSk7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVGRkVSID0gQnVmZmVyLmFsbG9jKDApO1xuXG5leHBvcnQgY2xhc3MgU3BlZXhSZXNhbXBsZXJUcmFuc2Zvcm0gZXh0ZW5kcyBUcmFuc2Zvcm0ge1xuICByZXNhbXBsZXI6IFNwZWV4UmVzYW1wbGVyO1xuICBfYWxpZ25lbWVudEJ1ZmZlcjogQnVmZmVyO1xuXG4gIC8qKlxuICAgICogQ3JlYXRlIGFuIFNwZWV4UmVzYW1wbGVyIGluc3RhbmNlLlxuICAgICogQHBhcmFtIGNoYW5uZWxzIE51bWJlciBvZiBjaGFubmVscywgbWluaW11bSBpcyAxLCBubyBtYXhpbXVtXG4gICAgKiBAcGFyYW0gaW5SYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIGlucHV0IGNodW5rXG4gICAgKiBAcGFyYW0gb3V0UmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSB0YXJnZXQgY2h1bmtcbiAgICAqIEBwYXJhbSBxdWFsaXR5IG51bWJlciBmcm9tIDEgdG8gMTAsIGRlZmF1bHQgdG8gNywgMSBpcyBmYXN0IGJ1dCBvZiBiYWQgcXVhbGl0eSwgMTAgaXMgc2xvdyBidXQgYmVzdCBxdWFsaXR5XG4gICAgKi9cbiAgY29uc3RydWN0b3IocHVibGljIGNoYW5uZWxzLCBwdWJsaWMgaW5SYXRlLCBwdWJsaWMgb3V0UmF0ZSwgcHVibGljIHF1YWxpdHkgPSA3KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc2FtcGxlciA9IG5ldyBTcGVleFJlc2FtcGxlcihjaGFubmVscywgaW5SYXRlLCBvdXRSYXRlLCBxdWFsaXR5KTtcbiAgICB0aGlzLmNoYW5uZWxzID0gY2hhbm5lbHM7XG4gICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlciA9IEVNUFRZX0JVRkZFUjtcbiAgfVxuXG4gIGFzeW5jIF90cmFuc2Zvcm0oY2h1bmssIGVuY29kaW5nLCBjYWxsYmFjaykge1xuICAgIGxldCBjaHVua1RvUHJvY2VzczogQnVmZmVyID0gY2h1bms7XG4gICAgaWYgKHRoaXMuX2FsaWduZW1lbnRCdWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBCdWZmZXIuY29uY2F0KFtcbiAgICAgICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlcixcbiAgICAgICAgY2h1bmssXG4gICAgICBdKTtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBFTVBUWV9CVUZGRVI7XG4gICAgfVxuICAgIC8vIFNwZWV4IG5lZWRzIGEgYnVmZmVyIGFsaWduZWQgdG8gMTZiaXRzIHRpbWVzIHRoZSBudW1iZXIgb2YgY2hhbm5lbHNcbiAgICAvLyBzbyB3ZSBrZWVwIHRoZSBleHRyYW5lb3VzIGJ5dGVzIGluIGEgYnVmZmVyIGZvciBuZXh0IGNodW5rXG4gICAgY29uc3QgZXh0cmFuZW91c0J5dGVzQ291bnQgPSBjaHVua1RvUHJvY2Vzcy5sZW5ndGggJSAodGhpcy5jaGFubmVscyAqIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKTtcbiAgICBpZiAoZXh0cmFuZW91c0J5dGVzQ291bnQgIT09IDApIHtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBCdWZmZXIuZnJvbShjaHVua1RvUHJvY2Vzcy5zbGljZShjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCkpO1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBjaHVua1RvUHJvY2Vzcy5zbGljZSgwLCBjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLnJlc2FtcGxlci5wcm9jZXNzQ2h1bmsoY2h1bmtUb1Byb2Nlc3MpO1xuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjYWxsYmFjayhlKTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgU3BlZXhSZXNhbXBsZXI7XG4iXX0=