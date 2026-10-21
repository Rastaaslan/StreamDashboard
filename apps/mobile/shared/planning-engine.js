/*!
Third-party dependency: crypto-js
# License

[The MIT License (MIT)](http://opensource.org/licenses/MIT)

Copyright (c) 2009-2013 Jeff Mott  
Copyright (c) 2013-2016 Evan Vosberg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


Third-party dependency: entities
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/crypto-js/core.js
var require_core = __commonJS({
  "node_modules/crypto-js/core.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory();
      } else if (typeof define === "function" && define.amd) {
        define([], factory);
      } else {
        root.CryptoJS = factory();
      }
    })(exports, function() {
      var CryptoJS2 = CryptoJS2 || (function(Math2, undefined2) {
        var crypto;
        if (typeof window !== "undefined" && window.crypto) {
          crypto = window.crypto;
        }
        if (typeof self !== "undefined" && self.crypto) {
          crypto = self.crypto;
        }
        if (typeof globalThis !== "undefined" && globalThis.crypto) {
          crypto = globalThis.crypto;
        }
        if (!crypto && typeof window !== "undefined" && window.msCrypto) {
          crypto = window.msCrypto;
        }
        if (!crypto && typeof global !== "undefined" && global.crypto) {
          crypto = global.crypto;
        }
        if (!crypto && typeof __require === "function") {
          try {
            crypto = __require("crypto");
          } catch (err) {
          }
        }
        var cryptoSecureRandomInt = function() {
          if (crypto) {
            if (typeof crypto.getRandomValues === "function") {
              try {
                return crypto.getRandomValues(new Uint32Array(1))[0];
              } catch (err) {
              }
            }
            if (typeof crypto.randomBytes === "function") {
              try {
                return crypto.randomBytes(4).readInt32LE();
              } catch (err) {
              }
            }
          }
          throw new Error("Native crypto module could not be used to get secure random number.");
        };
        var create = Object.create || /* @__PURE__ */ (function() {
          function F() {
          }
          return function(obj) {
            var subtype;
            F.prototype = obj;
            subtype = new F();
            F.prototype = null;
            return subtype;
          };
        })();
        var C = {};
        var C_lib = C.lib = {};
        var Base = C_lib.Base = /* @__PURE__ */ (function() {
          return {
            /**
             * Creates a new object that inherits from this object.
             *
             * @param {Object} overrides Properties to copy into the new object.
             *
             * @return {Object} The new object.
             *
             * @static
             *
             * @example
             *
             *     var MyType = CryptoJS.lib.Base.extend({
             *         field: 'value',
             *
             *         method: function () {
             *         }
             *     });
             */
            extend: function(overrides) {
              var subtype = create(this);
              if (overrides) {
                subtype.mixIn(overrides);
              }
              if (!subtype.hasOwnProperty("init") || this.init === subtype.init) {
                subtype.init = function() {
                  subtype.$super.init.apply(this, arguments);
                };
              }
              subtype.init.prototype = subtype;
              subtype.$super = this;
              return subtype;
            },
            /**
             * Extends this object and runs the init method.
             * Arguments to create() will be passed to init().
             *
             * @return {Object} The new object.
             *
             * @static
             *
             * @example
             *
             *     var instance = MyType.create();
             */
            create: function() {
              var instance = this.extend();
              instance.init.apply(instance, arguments);
              return instance;
            },
            /**
             * Initializes a newly created object.
             * Override this method to add some logic when your objects are created.
             *
             * @example
             *
             *     var MyType = CryptoJS.lib.Base.extend({
             *         init: function () {
             *             // ...
             *         }
             *     });
             */
            init: function() {
            },
            /**
             * Copies properties into this object.
             *
             * @param {Object} properties The properties to mix in.
             *
             * @example
             *
             *     MyType.mixIn({
             *         field: 'value'
             *     });
             */
            mixIn: function(properties) {
              for (var propertyName in properties) {
                if (properties.hasOwnProperty(propertyName)) {
                  this[propertyName] = properties[propertyName];
                }
              }
              if (properties.hasOwnProperty("toString")) {
                this.toString = properties.toString;
              }
            },
            /**
             * Creates a copy of this object.
             *
             * @return {Object} The clone.
             *
             * @example
             *
             *     var clone = instance.clone();
             */
            clone: function() {
              return this.init.prototype.extend(this);
            }
          };
        })();
        var WordArray = C_lib.WordArray = Base.extend({
          /**
           * Initializes a newly created word array.
           *
           * @param {Array} words (Optional) An array of 32-bit words.
           * @param {number} sigBytes (Optional) The number of significant bytes in the words.
           *
           * @example
           *
           *     var wordArray = CryptoJS.lib.WordArray.create();
           *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607]);
           *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607], 6);
           */
          init: function(words2, sigBytes) {
            words2 = this.words = words2 || [];
            if (sigBytes != undefined2) {
              this.sigBytes = sigBytes;
            } else {
              this.sigBytes = words2.length * 4;
            }
          },
          /**
           * Converts this word array to a string.
           *
           * @param {Encoder} encoder (Optional) The encoding strategy to use. Default: CryptoJS.enc.Hex
           *
           * @return {string} The stringified word array.
           *
           * @example
           *
           *     var string = wordArray + '';
           *     var string = wordArray.toString();
           *     var string = wordArray.toString(CryptoJS.enc.Utf8);
           */
          toString: function(encoder) {
            return (encoder || Hex).stringify(this);
          },
          /**
           * Concatenates a word array to this word array.
           *
           * @param {WordArray} wordArray The word array to append.
           *
           * @return {WordArray} This word array.
           *
           * @example
           *
           *     wordArray1.concat(wordArray2);
           */
          concat: function(wordArray) {
            var thisWords = this.words;
            var thatWords = wordArray.words;
            var thisSigBytes = this.sigBytes;
            var thatSigBytes = wordArray.sigBytes;
            this.clamp();
            if (thisSigBytes % 4) {
              for (var i = 0; i < thatSigBytes; i++) {
                var thatByte = thatWords[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                thisWords[thisSigBytes + i >>> 2] |= thatByte << 24 - (thisSigBytes + i) % 4 * 8;
              }
            } else {
              for (var j = 0; j < thatSigBytes; j += 4) {
                thisWords[thisSigBytes + j >>> 2] = thatWords[j >>> 2];
              }
            }
            this.sigBytes += thatSigBytes;
            return this;
          },
          /**
           * Removes insignificant bits.
           *
           * @example
           *
           *     wordArray.clamp();
           */
          clamp: function() {
            var words2 = this.words;
            var sigBytes = this.sigBytes;
            words2[sigBytes >>> 2] &= 4294967295 << 32 - sigBytes % 4 * 8;
            words2.length = Math2.ceil(sigBytes / 4);
          },
          /**
           * Creates a copy of this word array.
           *
           * @return {WordArray} The clone.
           *
           * @example
           *
           *     var clone = wordArray.clone();
           */
          clone: function() {
            var clone = Base.clone.call(this);
            clone.words = this.words.slice(0);
            return clone;
          },
          /**
           * Creates a word array filled with random bytes.
           *
           * @param {number} nBytes The number of random bytes to generate.
           *
           * @return {WordArray} The random word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.lib.WordArray.random(16);
           */
          random: function(nBytes) {
            var words2 = [];
            for (var i = 0; i < nBytes; i += 4) {
              words2.push(cryptoSecureRandomInt());
            }
            return new WordArray.init(words2, nBytes);
          }
        });
        var C_enc = C.enc = {};
        var Hex = C_enc.Hex = {
          /**
           * Converts a word array to a hex string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The hex string.
           *
           * @static
           *
           * @example
           *
           *     var hexString = CryptoJS.enc.Hex.stringify(wordArray);
           */
          stringify: function(wordArray) {
            var words2 = wordArray.words;
            var sigBytes = wordArray.sigBytes;
            var hexChars = [];
            for (var i = 0; i < sigBytes; i++) {
              var bite = words2[i >>> 2] >>> 24 - i % 4 * 8 & 255;
              hexChars.push((bite >>> 4).toString(16));
              hexChars.push((bite & 15).toString(16));
            }
            return hexChars.join("");
          },
          /**
           * Converts a hex string to a word array.
           *
           * @param {string} hexStr The hex string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Hex.parse(hexString);
           */
          parse: function(hexStr) {
            var hexStrLength = hexStr.length;
            var words2 = [];
            for (var i = 0; i < hexStrLength; i += 2) {
              words2[i >>> 3] |= parseInt(hexStr.substr(i, 2), 16) << 24 - i % 8 * 4;
            }
            return new WordArray.init(words2, hexStrLength / 2);
          }
        };
        var Latin1 = C_enc.Latin1 = {
          /**
           * Converts a word array to a Latin1 string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The Latin1 string.
           *
           * @static
           *
           * @example
           *
           *     var latin1String = CryptoJS.enc.Latin1.stringify(wordArray);
           */
          stringify: function(wordArray) {
            var words2 = wordArray.words;
            var sigBytes = wordArray.sigBytes;
            var latin1Chars = [];
            for (var i = 0; i < sigBytes; i++) {
              var bite = words2[i >>> 2] >>> 24 - i % 4 * 8 & 255;
              latin1Chars.push(String.fromCharCode(bite));
            }
            return latin1Chars.join("");
          },
          /**
           * Converts a Latin1 string to a word array.
           *
           * @param {string} latin1Str The Latin1 string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Latin1.parse(latin1String);
           */
          parse: function(latin1Str) {
            var latin1StrLength = latin1Str.length;
            var words2 = [];
            for (var i = 0; i < latin1StrLength; i++) {
              words2[i >>> 2] |= (latin1Str.charCodeAt(i) & 255) << 24 - i % 4 * 8;
            }
            return new WordArray.init(words2, latin1StrLength);
          }
        };
        var Utf8 = C_enc.Utf8 = {
          /**
           * Converts a word array to a UTF-8 string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The UTF-8 string.
           *
           * @static
           *
           * @example
           *
           *     var utf8String = CryptoJS.enc.Utf8.stringify(wordArray);
           */
          stringify: function(wordArray) {
            try {
              return decodeURIComponent(escape(Latin1.stringify(wordArray)));
            } catch (e) {
              throw new Error("Malformed UTF-8 data");
            }
          },
          /**
           * Converts a UTF-8 string to a word array.
           *
           * @param {string} utf8Str The UTF-8 string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Utf8.parse(utf8String);
           */
          parse: function(utf8Str) {
            return Latin1.parse(unescape(encodeURIComponent(utf8Str)));
          }
        };
        var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm = Base.extend({
          /**
           * Resets this block algorithm's data buffer to its initial state.
           *
           * @example
           *
           *     bufferedBlockAlgorithm.reset();
           */
          reset: function() {
            this._data = new WordArray.init();
            this._nDataBytes = 0;
          },
          /**
           * Adds new data to this block algorithm's buffer.
           *
           * @param {WordArray|string} data The data to append. Strings are converted to a WordArray using UTF-8.
           *
           * @example
           *
           *     bufferedBlockAlgorithm._append('data');
           *     bufferedBlockAlgorithm._append(wordArray);
           */
          _append: function(data) {
            if (typeof data == "string") {
              data = Utf8.parse(data);
            }
            this._data.concat(data);
            this._nDataBytes += data.sigBytes;
          },
          /**
           * Processes available data blocks.
           *
           * This method invokes _doProcessBlock(offset), which must be implemented by a concrete subtype.
           *
           * @param {boolean} doFlush Whether all blocks and partial blocks should be processed.
           *
           * @return {WordArray} The processed data.
           *
           * @example
           *
           *     var processedData = bufferedBlockAlgorithm._process();
           *     var processedData = bufferedBlockAlgorithm._process(!!'flush');
           */
          _process: function(doFlush) {
            var processedWords;
            var data = this._data;
            var dataWords = data.words;
            var dataSigBytes = data.sigBytes;
            var blockSize = this.blockSize;
            var blockSizeBytes = blockSize * 4;
            var nBlocksReady = dataSigBytes / blockSizeBytes;
            if (doFlush) {
              nBlocksReady = Math2.ceil(nBlocksReady);
            } else {
              nBlocksReady = Math2.max((nBlocksReady | 0) - this._minBufferSize, 0);
            }
            var nWordsReady = nBlocksReady * blockSize;
            var nBytesReady = Math2.min(nWordsReady * 4, dataSigBytes);
            if (nWordsReady) {
              for (var offset = 0; offset < nWordsReady; offset += blockSize) {
                this._doProcessBlock(dataWords, offset);
              }
              processedWords = dataWords.splice(0, nWordsReady);
              data.sigBytes -= nBytesReady;
            }
            return new WordArray.init(processedWords, nBytesReady);
          },
          /**
           * Creates a copy of this object.
           *
           * @return {Object} The clone.
           *
           * @example
           *
           *     var clone = bufferedBlockAlgorithm.clone();
           */
          clone: function() {
            var clone = Base.clone.call(this);
            clone._data = this._data.clone();
            return clone;
          },
          _minBufferSize: 0
        });
        var Hasher = C_lib.Hasher = BufferedBlockAlgorithm.extend({
          /**
           * Configuration options.
           */
          cfg: Base.extend(),
          /**
           * Initializes a newly created hasher.
           *
           * @param {Object} cfg (Optional) The configuration options to use for this hash computation.
           *
           * @example
           *
           *     var hasher = CryptoJS.algo.SHA256.create();
           */
          init: function(cfg) {
            this.cfg = this.cfg.extend(cfg);
            this.reset();
          },
          /**
           * Resets this hasher to its initial state.
           *
           * @example
           *
           *     hasher.reset();
           */
          reset: function() {
            BufferedBlockAlgorithm.reset.call(this);
            this._doReset();
          },
          /**
           * Updates this hasher with a message.
           *
           * @param {WordArray|string} messageUpdate The message to append.
           *
           * @return {Hasher} This hasher.
           *
           * @example
           *
           *     hasher.update('message');
           *     hasher.update(wordArray);
           */
          update: function(messageUpdate) {
            this._append(messageUpdate);
            this._process();
            return this;
          },
          /**
           * Finalizes the hash computation.
           * Note that the finalize operation is effectively a destructive, read-once operation.
           *
           * @param {WordArray|string} messageUpdate (Optional) A final message update.
           *
           * @return {WordArray} The hash.
           *
           * @example
           *
           *     var hash = hasher.finalize();
           *     var hash = hasher.finalize('message');
           *     var hash = hasher.finalize(wordArray);
           */
          finalize: function(messageUpdate) {
            if (messageUpdate) {
              this._append(messageUpdate);
            }
            var hash = this._doFinalize();
            return hash;
          },
          blockSize: 512 / 32,
          /**
           * Creates a shortcut function to a hasher's object interface.
           *
           * @param {Hasher} hasher The hasher to create a helper for.
           *
           * @return {Function} The shortcut function.
           *
           * @static
           *
           * @example
           *
           *     var SHA256 = CryptoJS.lib.Hasher._createHelper(CryptoJS.algo.SHA256);
           */
          _createHelper: function(hasher) {
            return function(message, cfg) {
              return new hasher.init(cfg).finalize(message);
            };
          },
          /**
           * Creates a shortcut function to the HMAC's object interface.
           *
           * @param {Hasher} hasher The hasher to use in this HMAC helper.
           *
           * @return {Function} The shortcut function.
           *
           * @static
           *
           * @example
           *
           *     var HmacSHA256 = CryptoJS.lib.Hasher._createHmacHelper(CryptoJS.algo.SHA256);
           */
          _createHmacHelper: function(hasher) {
            return function(message, key2) {
              return new C_algo.HMAC.init(hasher, key2).finalize(message);
            };
          }
        });
        var C_algo = C.algo = {};
        return C;
      })(Math);
      return CryptoJS2;
    });
  }
});

// node_modules/crypto-js/sha256.js
var require_sha256 = __commonJS({
  "node_modules/crypto-js/sha256.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function(Math2) {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var Hasher = C_lib.Hasher;
        var C_algo = C.algo;
        var H = [];
        var K = [];
        (function() {
          function isPrime(n2) {
            var sqrtN = Math2.sqrt(n2);
            for (var factor = 2; factor <= sqrtN; factor++) {
              if (!(n2 % factor)) {
                return false;
              }
            }
            return true;
          }
          function getFractionalBits(n2) {
            return (n2 - (n2 | 0)) * 4294967296 | 0;
          }
          var n = 2;
          var nPrime = 0;
          while (nPrime < 64) {
            if (isPrime(n)) {
              if (nPrime < 8) {
                H[nPrime] = getFractionalBits(Math2.pow(n, 1 / 2));
              }
              K[nPrime] = getFractionalBits(Math2.pow(n, 1 / 3));
              nPrime++;
            }
            n++;
          }
        })();
        var W = [];
        var SHA2562 = C_algo.SHA256 = Hasher.extend({
          _doReset: function() {
            this._hash = new WordArray.init(H.slice(0));
          },
          _doProcessBlock: function(M, offset) {
            var H2 = this._hash.words;
            var a = H2[0];
            var b = H2[1];
            var c = H2[2];
            var d = H2[3];
            var e = H2[4];
            var f = H2[5];
            var g = H2[6];
            var h = H2[7];
            for (var i = 0; i < 64; i++) {
              if (i < 16) {
                W[i] = M[offset + i] | 0;
              } else {
                var gamma0x = W[i - 15];
                var gamma0 = (gamma0x << 25 | gamma0x >>> 7) ^ (gamma0x << 14 | gamma0x >>> 18) ^ gamma0x >>> 3;
                var gamma1x = W[i - 2];
                var gamma1 = (gamma1x << 15 | gamma1x >>> 17) ^ (gamma1x << 13 | gamma1x >>> 19) ^ gamma1x >>> 10;
                W[i] = gamma0 + W[i - 7] + gamma1 + W[i - 16];
              }
              var ch = e & f ^ ~e & g;
              var maj = a & b ^ a & c ^ b & c;
              var sigma0 = (a << 30 | a >>> 2) ^ (a << 19 | a >>> 13) ^ (a << 10 | a >>> 22);
              var sigma1 = (e << 26 | e >>> 6) ^ (e << 21 | e >>> 11) ^ (e << 7 | e >>> 25);
              var t1 = h + sigma1 + ch + K[i] + W[i];
              var t2 = sigma0 + maj;
              h = g;
              g = f;
              f = e;
              e = d + t1 | 0;
              d = c;
              c = b;
              b = a;
              a = t1 + t2 | 0;
            }
            H2[0] = H2[0] + a | 0;
            H2[1] = H2[1] + b | 0;
            H2[2] = H2[2] + c | 0;
            H2[3] = H2[3] + d | 0;
            H2[4] = H2[4] + e | 0;
            H2[5] = H2[5] + f | 0;
            H2[6] = H2[6] + g | 0;
            H2[7] = H2[7] + h | 0;
          },
          _doFinalize: function() {
            var data = this._data;
            var dataWords = data.words;
            var nBitsTotal = this._nDataBytes * 8;
            var nBitsLeft = data.sigBytes * 8;
            dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
            dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = Math2.floor(nBitsTotal / 4294967296);
            dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = nBitsTotal;
            data.sigBytes = dataWords.length * 4;
            this._process();
            return this._hash;
          },
          clone: function() {
            var clone = Hasher.clone.call(this);
            clone._hash = this._hash.clone();
            return clone;
          }
        });
        C.SHA256 = Hasher._createHelper(SHA2562);
        C.HmacSHA256 = Hasher._createHmacHelper(SHA2562);
      })(Math);
      return CryptoJS2.SHA256;
    });
  }
});

// packages/core/src/uuid.ts
function randomUuid() {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function") {
    throw new Error("G\xE9n\xE9ration s\xE9curis\xE9e des identifiants indisponible. Mettez \xE0 jour le navigateur ou Android System WebView.");
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// apps/mobile/shared/recurrence.js
function migrateRecurrence(rule) {
  if (!rule || ![void 0, 1, 2].includes(rule.version) || !["daily", "weekly", "monthly"].includes(rule.frequency) || !Number.isSafeInteger(rule.interval) || rule.interval < 1 || rule.version !== 2 && !(rule.interval === 1 || rule.interval === 2) || rule.custom && (rule.version !== 2 || typeof rule.custom.engine !== "string" || !rule.custom.engine || !Number.isSafeInteger(rule.custom.version) || rule.custom.version < 1 || !rule.custom.parameters || typeof rule.custom.parameters !== "object" || Array.isArray(rule.custom.parameters))) {
    throw new Error("Version ou r\xE8gle de r\xE9currence non prise en charge.");
  }
  return { ...structuredClone(rule), version: 2 };
}
var DAY = 864e5;
var pad = (value) => String(value).padStart(2, "0");
var wallKey = (v) => `${v.year}-${pad(v.month)}-${pad(v.day)}T${pad(v.hour)}:${pad(v.minute)}:${pad(v.second)}`;
var wallEpoch = (v) => Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
function instant(value) {
  const result = +new Date(value);
  if (!Number.isFinite(result))
    throw new Error("Invalid recurrence date");
  return result;
}
function bounds(window2) {
  const start = instant(window2.windowStart), end = instant(window2.windowEnd);
  if (end <= start)
    throw new Error("Invalid projection window");
  return [start, end];
}
function clock(zone) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = (at) => Object.fromEntries(formatter.formatToParts(new Date(at)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  const resolve = (wall) => {
    const target = wallEpoch(wall);
    const offsets = new Set([-2, -1, 0, 1, 2].map((days) => {
      const probe = target + days * DAY;
      return wallEpoch(parts(probe)) - probe;
    }));
    const candidates = [...offsets].map((offset) => target - offset).sort((a, b) => a - b);
    return candidates.find((at) => wallEpoch(parts(at)) === target) ?? Math.max(...candidates);
  };
  return { parts, resolve };
}
function schedule(anchor, rule) {
  if (!["daily", "weekly", "monthly"].includes(rule.frequency) || !Number.isSafeInteger(rule.interval) || rule.interval < 1)
    throw new Error("Invalid recurrence cadence");
  const stride = rule.interval * (rule.frequency === "weekly" ? 7 : 1);
  return (step) => {
    if (rule.frequency === "monthly") {
      const monthIndex = anchor.year * 12 + anchor.month - 1 + step * stride;
      const year = Math.floor(monthIndex / 12), month = monthIndex % 12 + 1;
      return { ...anchor, year, month, day: Math.min(anchor.day, new Date(Date.UTC(year, month, 0)).getUTCDate()) };
    }
    const date = new Date(wallEpoch(anchor) + step * stride * DAY);
    return { ...anchor, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  };
}
function projectRecurrence(source, window2) {
  if (source.deletionPending) return [];
  const counted = window2.nextCount !== void 0;
  if (counted && (!Number.isSafeInteger(window2.nextCount) || window2.nextCount < 1 || window2.nextCount > 1e4))
    throw new Error("Invalid nextCount (1\u201310000 required)");
  const [from, to] = counted ? [instant(window2.windowStart), Infinity] : bounds(window2);
  if (!source.recurrence || source.occurrenceKey)
    throw new Error("Expected a canonical recurring master");
  const rule = migrateRecurrence(source.recurrence);
  if (rule.custom)
    throw new Error("Moteur de r\xE9currence requis : " + rule.custom.engine);
  const start = instant(source.startAtUtc), duration = instant(source.endAtUtc) - start;
  if (duration <= 0)
    throw new Error("Invalid recurrence duration");
  const until = rule.until == null ? Infinity : instant(rule.until);
  const { parts, resolve } = clock(rule.timeZone || "Europe/Paris");
  const anchor = parts(start), at = schedule(anchor, rule);
  const seriesId = source.localId || source.id;
  if (!seriesId)
    throw new Error("Missing series identity");
  const key2 = (wall) => `${seriesId}:${wallKey(wall)}`;
  const seek = (target) => {
    let low = 0, high = 1;
    while (resolve(at(high)) < target)
      high *= 2;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (resolve(at(mid)) < target)
        low = mid + 1;
      else
        high = mid;
    }
    return low;
  };
  const candidates = /* @__PURE__ */ new Map();
  for (const exceptionKey of Object.keys(rule.exceptions ?? {})) {
    const prefix = `${seriesId}:`;
    if (!exceptionKey.startsWith(prefix))
      continue;
    const local = exceptionKey.slice(prefix.length);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local))
      continue;
    const target = Date.parse(`${local}Z`);
    if (!Number.isFinite(target))
      continue;
    let low = 0, high = 1;
    while (wallEpoch(at(high)) < target)
      high *= 2;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (wallEpoch(at(mid)) < target)
        low = mid + 1;
      else
        high = mid;
    }
    const wall = at(low);
    if (key2(wall) === exceptionKey && resolve(wall) <= until)
      candidates.set(exceptionKey, wall);
  }
  const output = /* @__PURE__ */ new Map();
  const add = (occurrenceKey, wall) => {
    const exception = rule.exceptions?.[occurrenceKey];
    if (exception?.cancelled)
      return;
    const original = resolve(wall);
    const item = {
      ...structuredClone(source),
      ...structuredClone(exception?.patch ?? {}),
      id: `${source.id}::${wallKey(wall)}`,
      seriesId: source.id,
      occurrenceKey,
      recurrence: structuredClone(source.recurrence),
      startAtUtc: exception?.patch?.startAtUtc ?? new Date(original).toISOString(),
      endAtUtc: exception?.patch?.endAtUtc ?? new Date(original + duration).toISOString()
    };
    const effectiveStart = instant(item.startAtUtc), effectiveEnd = instant(item.endAtUtc);
    if (effectiveEnd <= effectiveStart)
      throw new Error("Invalid occurrence duration");
    if (effectiveStart < to && effectiveEnd > from && (!window2.accept || window2.accept(item)))
      output.set(occurrenceKey, item);
  };
  for (const [occurrenceKey, wall] of candidates) add(occurrenceKey, wall);
  const sorted = () => [...output.values()].sort((a, b) => instant(a.startAtUtc) - instant(b.startAtUtc) || (a.occurrenceKey < b.occurrenceKey ? -1 : a.occurrenceKey > b.occurrenceKey ? 1 : 0));
  let scanned = 0;
  for (let step = seek(from - duration - 2 * DAY); ; step++) {
    if (++scanned > 1e5) throw new Error("Recurrence scan limit exceeded");
    const wall = at(step), original = resolve(wall);
    if (!Number.isFinite(original)) throw new Error("Invalid recurrence cadence range");
    if (original >= to || original > until) break;
    if (counted && output.size >= window2.nextCount && original > instant(sorted()[window2.nextCount - 1].startAtUtc)) break;
    add(key2(wall), wall);
  }
  return counted ? sorted().slice(0, window2.nextCount) : sorted();
}
function expandRecurringItems(items, { from, to, nextCount, accept }) {
  const [start, end] = nextCount === void 0 ? bounds({ windowStart: from, windowEnd: to }) : [instant(from), Infinity];
  return (items || []).flatMap((item) => item.deletionPending ? [structuredClone(item)] : item.recurrence && !item.occurrenceKey ? projectRecurrence(item, { windowStart: from, windowEnd: to, nextCount, accept }) : Date.parse(item.startAtUtc) < end && (Number.isFinite(Date.parse(item.endAtUtc)) ? Date.parse(item.endAtUtc) > start : Date.parse(item.startAtUtc) >= start) ? [structuredClone(item)] : []).sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc));
}
function recurrenceForNewSeries(rule, id) {
  if (!rule) return rule;
  const copy = structuredClone(rule);
  if (copy.exceptions) copy.exceptions = Object.fromEntries(Object.entries(copy.exceptions).map(([key2, value]) => {
    const match = key2.match(/:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/);
    return [match ? `${id}:${match[1]}` : key2, value];
  }));
  return copy;
}

// scripts/mobile-sync-shim.js
var syncBatch = (work) => work();
var measureSync = (_provider, _phase, work) => work();
async function boundedMap(values, work) {
  for (const value of values) await work(value);
}

// packages/core/src/series-deletion.ts
async function recoverIdentity(identity2, name2, provider, persist) {
  if (!identity2.uncertainCreate) return;
  if (!provider?.recoverCreation) throw new Error(`${name2} : r\xE9cup\xE9ration en lecture seule indisponible. Reconnectez le provider puis r\xE9essayez la suppression.`);
  const original = structuredClone(identity2.uncertainCreate.event);
  const recovered = await provider.recoverCreation({ ...original, providers: { [name2]: identity2 } });
  if (!recovered.id || recovered.owned !== true) throw new Error(`${name2} : ownership non \xE9tabli. V\xE9rifiez l\u2019identit\xE9 distante avant de r\xE9essayer.`);
  identity2.remoteId = recovered.id;
  identity2.remoteRevision = recovered.revision;
  identity2.fingerprint = recovered.fingerprint;
  identity2.calendarId = recovered.calendarId ?? identity2.calendarId;
  identity2.projectionOwned = true;
  identity2.status = "pending";
  if ("event" in identity2) identity2.event = original;
  delete identity2.uncertainCreate;
  delete identity2.lastError;
  await persist();
}
async function recoverSeriesDeletionIdentities(item, providers, persist) {
  for (const name2 of ["twitch", "google"]) {
    const link = item.providers?.[name2];
    if (!link) continue;
    let recovered = false;
    for (const identity2 of [link, ...Object.values(link.projections ?? {}).filter((entry) => entry.managedBy === "StreamDashboard" && entry.projectionOwned !== false)]) {
      if (!identity2.uncertainCreate) continue;
      try {
        await recoverIdentity(identity2, name2, providers[name2], persist);
        recovered = true;
      } catch (error) {
        identity2.status = "error";
        identity2.lastError = error.message;
        link.status = "error";
        link.lastError = `Suppression en attente : ${identity2.lastError}`;
        await persist();
      }
    }
    if (recovered && ![link, ...Object.values(link.projections ?? {})].some((identity2) => identity2.uncertainCreate)) {
      link.status = "error";
      link.lastError = "Suppression en attente : identit\xE9 retrouv\xE9e. R\xE9essayez la suppression pour terminer le nettoyage distant.";
      await persist();
    }
  }
}
async function deleteSeriesProjections(item, providers, save, retry = false) {
  let saves = Promise.resolve();
  let queued;
  const persist = () => {
    if (!queued) {
      queued = saves.then(() => {
        queued = void 0;
        return save();
      });
      saves = queued;
    }
    return queued;
  };
  const failures = [];
  for (const name2 of ["twitch", "google"]) {
    const link = item.providers?.[name2];
    if (!link) continue;
    if (name2 === "twitch" && link.projectionOwned && !link.remoteId) link.remoteId = item.twitchSegmentId;
    const remove = async (identity2, event) => {
      if (identity2.uncertainCreate) {
        const original = structuredClone(identity2.uncertainCreate.event);
        await recoverIdentity(identity2, name2, providers[name2], persist);
        event = { ...original, providers: { [name2]: identity2 } };
      }
      if (!identity2.remoteId) return;
      const provider = providers[name2];
      if (!provider) throw new Error(`${name2} non connect\xE9.`);
      if (identity2.status === "conflict") {
        if (!retry) throw Object.assign(new Error("Conflit distant : r\xE9essayez explicitement la suppression pour confirmer le retrait courant."), { status: 412 });
        if (!provider.read) throw new Error("Lecture distante requise pour confirmer la suppression en conflit.");
        const latest = await provider.read(identity2.remoteId, event, { resolveConflict: true });
        if (latest.deleted) {
          delete identity2.remoteId;
          delete identity2.remoteRevision;
          await persist();
          return;
        }
        if (name2 === "google" && !latest.revision) throw new Error("ETag courant requis pour supprimer.");
        if (name2 === "twitch" && !latest.fingerprint) throw new Error("Empreinte courante requise pour supprimer.");
        identity2.remoteRevision = latest.revision;
        identity2.fingerprint = latest.fingerprint;
      }
      identity2.status = "pending";
      try {
        await provider.delete(identity2.remoteId, event, identity2.remoteRevision);
      } catch (error) {
        const failure = error;
        if (![404, 410].includes(failure.status ?? 0) && failure.code !== "DELETED_REMOTELY") throw error;
      }
      delete identity2.remoteId;
      delete identity2.remoteRevision;
      delete identity2.fingerprint;
      identity2.status = "not-published";
      delete identity2.lastError;
      await persist();
    };
    const attempt = async (identity2, event) => {
      try {
        await remove(identity2, event);
        return true;
      } catch (error) {
        const failure = error;
        identity2.status = identity2.status === "conflict" || failure.status === 412 || ["CONFLICT", "GOOGLE_PROJECTION_CONFLICT"].includes(failure.code ?? "") ? "conflict" : "error";
        identity2.lastError = error.message;
        failures.push(`${name2}: ${identity2.lastError}`);
        await persist();
        return false;
      }
    };
    if (link.projectionOwned === true || link.uncertainCreate) {
      if (await attempt(link, { ...item, providers: { [name2]: link } })) {
        if (name2 === "twitch") delete item.twitchSegmentId;
      }
    }
    await boundedMap(Object.entries(link.projections ?? {}), async ([key2, entry]) => {
      if (entry.managedBy !== "StreamDashboard" || entry.projectionOwned === false) return;
      entry.pendingDeletion = true;
      const { recurrence, seriesId, occurrenceKey, providers: ignored, conflict, twitchSegmentId, ...body } = entry.event;
      const event = { ...body, twitchRecurring: false, providers: { [name2]: entry } };
      if (await attempt(entry, event)) delete link.projections[key2];
    });
    if (failures.some((value) => value.startsWith(name2 + ":"))) {
      if (link.status !== "conflict") link.status = "error";
      link.lastError = `Suppression de s\xE9rie en attente. R\xE9essayez la suppression : ${failures.filter((value) => value.startsWith(name2 + ":")).join("; ")}`;
    } else {
      delete item.providers[name2];
      if (item.conflict?.provider === name2) delete item.conflict;
    }
    await persist();
  }
  if (failures.length) throw new Error(`Suppression de s\xE9rie incompl\xE8te. R\xE9essayez la suppression : ${failures.join("; ")}`);
}

// scripts/mobile-hash-shim.js
var import_sha256 = __toESM(require_sha256(), 1);
var import_core = __toESM(require_core(), 1);
function createBinaryHash() {
  const hash = import_core.default.algo.SHA256.create();
  let result;
  return { update(bytes) {
    if (result !== void 0 || !(bytes instanceof Uint8Array)) throw new Error("Invalid binary hash input");
    const words2 = [];
    for (let index = 0; index < bytes.length; index++) words2[index >>> 2] = (words2[index >>> 2] || 0) | bytes[index] << 24 - index % 4 * 8;
    hash.update(import_core.default.lib.WordArray.create(words2, bytes.length));
    return this;
  }, digest() {
    return result ??= hash.finalize().toString();
  } };
}
function createHash(algorithm) {
  if (algorithm !== "sha256") throw new Error("Unsupported identity hash");
  let value = "";
  return { update(part) {
    value += part;
    return this;
  }, digest(encoding) {
    if (encoding !== "hex") throw new Error("Unsupported identity encoding");
    return (0, import_sha256.default)(value).toString();
  } };
}

// integrations/google-calendar/src/recurrence.ts
function assertGoogleMaterializedAllDay(input) {
  if (!input.allDay) return;
  const midnight = (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === `${value.slice(0, 10)}T00:00:00.000Z`;
  if (!midnight(input.startAtUtc) || !midnight(input.endAtUtc) || Date.parse(input.endAtUtc) <= Date.parse(input.startAtUtc)) {
    throw Object.assign(new Error("Occurrence all-day Google non repr\xE9sentable : les bornes doivent \xEAtre \xE0 minuit UTC, avec une fin exclusive."), { mutationNotStarted: true });
  }
}
function parseGoogleRecurrence(input) {
  const lines = input.recurrenceLines ?? [];
  if (!lines.length) return void 0;
  const refuse = () => {
    throw Object.assign(new Error("R\xE9currence Google non repr\xE9sentable : import de la s\xE9rie refus\xE9 pour pr\xE9server ses occurrences."), { mutationNotStarted: true });
  };
  if (lines.length !== 1 || typeof lines[0] !== "string" || !lines[0].startsWith("RRULE:")) return refuse();
  const parts = /* @__PURE__ */ Object.create(null);
  for (const clause of lines[0].slice(6).split(";")) {
    const pair = clause.split("=");
    if (pair.length !== 2 || !pair[1] || Object.hasOwn(parts, pair[0])) return refuse();
    parts[pair[0]] = pair[1];
  }
  parts.INTERVAL ??= "1";
  const timeZone = input.allDay ? "UTC" : input.recurrenceTimeZone;
  if (!timeZone) return refuse();
  let until;
  if (parts.UNTIL) {
    const raw = parts.UNTIL;
    if (!(input.allDay ? /^\d{8}$/ : /^\d{8}T\d{6}Z$/).test(raw)) return refuse();
    until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${input.allDay ? "00:00:00" : `${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}`}Z`;
  }
  const rule = { frequency: parts.FREQ?.toLowerCase(), interval: Number(parts.INTERVAL), timeZone, ...until ? { until } : {} };
  if (!(rule.interval === 1 || rule.frequency === "weekly" && rule.interval === 2)) rule.version = 2;
  const canonical = googleRecurrence({ ...input, recurrence: rule })[0].slice(6).split(";").sort();
  if (JSON.stringify(canonical) !== JSON.stringify(Object.entries(parts).map(([key2, value]) => `${key2}=${value}`).sort())) return refuse();
  return rule;
}
function googleRecurrence(input) {
  const refuse = (message) => {
    throw Object.assign(new Error(`R\xE9currence Google non repr\xE9sentable : ${message}`), { mutationNotStarted: true });
  };
  if (input.seriesId || input.occurrenceKey) refuse("publiez la s\xE9rie, pas une occurrence virtuelle.");
  const rule = input.recurrence;
  if (!rule) return [];
  if (![void 0, 1, 2].includes(rule.version) || rule.custom) refuse("version ou moteur custom non repr\xE9sentable nativement.");
  if (Object.keys(rule.exceptions ?? {}).length) refuse("les exceptions doivent \xEAtre conserv\xE9es localement ; aucune mutation Google effectu\xE9e.");
  if (!["daily", "weekly", "monthly"].includes(rule.frequency) || !(rule.version === 2 ? Number.isSafeInteger(rule.interval) && rule.interval > 0 : rule.interval === 1 || rule.frequency === "weekly" && rule.interval === 2)) refuse("cadence non prise en charge.");
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: rule.timeZone, day: "numeric" });
  } catch {
    return refuse("fuseau horaire invalide.");
  }
  if (!rule.timeZone || !Number.isFinite(Date.parse(input.startAtUtc))) refuse("ancre ou fuseau horaire invalide.");
  if (input.allDay && (formatter.resolvedOptions().timeZone !== "UTC" || new Date(input.startAtUtc).toISOString().slice(11) !== "00:00:00.000Z")) {
    refuse("une s\xE9rie all-day exige une ancre \xE0 minuit UTC et un fuseau UTC ; les autres fuseaux peuvent d\xE9caler les dates et la borne until.");
  }
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`, `INTERVAL=${rule.interval}`];
  if (rule.frequency === "monthly") {
    const day = Number(formatter.format(new Date(input.startAtUtc)));
    parts.push(`BYMONTHDAY=${day > 28 ? Array.from({ length: 32 - day }, (_, index) => day + index).join(",") + ",-1" : day}`);
    if (day > 28) parts.push("BYSETPOS=1");
  }
  if (rule.until) {
    const until = new Date(rule.until);
    if (!Number.isFinite(+until) || +until < Date.parse(input.startAtUtc)) refuse("fin invalide ou ant\xE9rieure \xE0 la s\xE9rie.");
    parts.push(`UNTIL=${input.allDay ? until.toISOString().slice(0, 10).replaceAll("-", "") : until.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
  }
  return [`RRULE:${parts.join(";")}`];
}

// integrations/twitch/src/recurrence.ts
function assertTwitchRecurrence(item) {
  const rule = item.recurrence;
  const fail = () => {
    throw Object.assign(new Error("Twitch : r\xE9currence non repr\xE9sentable ; seules les s\xE9ries weekly-1 sans fin ni exceptions sont accept\xE9es."), { mutationNotStarted: true });
  };
  if (item.seriesId || item.occurrenceKey) fail();
  if (!rule) {
    if (item.ownership === "LOCAL" && item.twitchRecurring && item.providers?.twitch?.projectionOwned && item.providers.twitch.projectionMode === "native") fail();
    return;
  }
  if (rule.custom || ![void 0, 1, 2].includes(rule.version) || rule.frequency !== "weekly" || rule.interval !== 1 || rule.until || Object.keys(rule.exceptions ?? {}).length || !rule.timeZone) fail();
  try {
    new Intl.DateTimeFormat("en", { timeZone: rule.timeZone });
  } catch {
    fail();
  }
}

// integrations/twitch/src/create-request.ts
var prepared = /* @__PURE__ */ new WeakSet();
function twitchCreateRequest(item, now = Date.now()) {
  if (item.deletionPending)
    throw Object.assign(new Error("Suppression en attente : cr\xE9ation Twitch interdite."), { mutationNotStarted: true });
  if (prepared.has(item))
    return item;
  assertTwitchRecurrence(item);
  const request3 = structuredClone(item);
  if (item.recurrence && Date.parse(item.startAtUtc) <= now) {
    const next = expandRecurringItems([item], { from: now, nextCount: 1, accept: (value) => Date.parse(value.startAtUtc) > now })[0];
    if (!next)
      throw Object.assign(new Error("Aucune occurrence Twitch future valide."), { mutationNotStarted: true });
    request3.startAtUtc = next.startAtUtc;
    request3.endAtUtc = next.endAtUtc;
  }
  prepared.add(request3);
  return request3;
}

// apps/mobile/shared/publication-content.js
function publicationContent(event, provider) {
  const fields = provider === "twitch" ? [event.title || "", event.startAtUtc || "", event.endAtUtc || "", event.twitchCategoryId || ""] : [event.title || "", event.description || "", event.startAtUtc || "", event.endAtUtc || "", Boolean(event.allDay)];
  return JSON.stringify([
    ...fields,
    event.recurrence || null,
    event.seriesId || null,
    event.occurrenceKey || null,
    event.desiredPublication?.[provider] === true
  ], (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((key2) => [key2, value[key2]])) : value);
}

// packages/core/src/provider-identity.ts
function assertProviderCreationCertain(item, provider) {
  if (item.providers?.[provider]?.uncertainCreate) {
    throw Object.assign(new Error("Cr\xE9ation distante incertaine. R\xE9conciliez son identit\xE9 avant de republier."), {
      code: "PROVIDER_CREATE_UNCERTAIN"
    });
  }
}
function isDefinitiveCreateFailure(error) {
  const failure = error;
  return failure?.mutationNotStarted === true || [400, 401, 403, 404, 405, 410, 412, 413, 415, 422, 429].includes(failure?.status ?? 0);
}
async function createWithDurableIntent(item, provider, persist, create, prepare) {
  assertProviderCreationCertain(item, provider);
  if (item.deletionPending) throw Object.assign(new Error("Suppression en attente : cr\xE9ation interdite."), { mutationNotStarted: true });
  const link = (item.providers ??= {})[provider] ??= { status: "pending" };
  if (prepare) {
    const destination = await prepare(item);
    if (destination.calendarId) link.calendarId = destination.calendarId;
    if (link.accountId && destination.accountId && link.accountId !== destination.accountId) throw Object.assign(new Error("Reconnectez le compte propri\xE9taire de cette publication."), { mutationNotStarted: true });
    if (destination.accountId) link.accountId = destination.accountId;
  }
  const request3 = provider === "twitch" ? twitchCreateRequest(item) : structuredClone(item);
  const { providers: _providers, conflict: _conflict, ...original } = request3;
  link.uncertainCreate = {
    event: structuredClone(original),
    publishedContent: publicationContent(item, provider)
  };
  await persist();
  delete request3.providers[provider].uncertainCreate;
  let result;
  try {
    result = await create(request3);
  } catch (error) {
    if (isDefinitiveCreateFailure(error)) {
      delete link.uncertainCreate;
      await persist();
    }
    throw error;
  }
  if (!result.id) throw new Error("Cr\xE9ation distante accept\xE9e sans identit\xE9. R\xE9conciliation requise.");
  link.remoteId = result.id;
  link.remoteRevision = result.revision;
  link.fingerprint = result.fingerprint;
  link.calendarId = result.calendarId ?? link.calendarId;
  delete link.uncertainCreate;
  return result;
}

// packages/core/src/provider-projection.ts
function projectionContent(item, name2) {
  return JSON.stringify(name2 === "twitch" ? [item.title, item.startAtUtc, item.endAtUtc, item.twitchCategoryId ?? ""] : [item.title, item.description, item.allDay, item.startAtUtc, item.endAtUtc, item.twitchCategoryId ?? ""]);
}
function request(event, link, name2) {
  const { recurrence, seriesId, occurrenceKey, providers, conflict, twitchSegmentId, ...body } = event;
  if (name2 === "google" && body.projection?.mode === "materialized") body.projection = { ...body.projection, creationId: link.creationId };
  return { ...body, twitchRecurring: false, providers: { [name2]: link } };
}
function reconcileProviderProjection(...args) {
  const [item, original, save, options] = args;
  if (item.deletionPending) return Promise.resolve(true);
  if (!options.materialized && !item.providers?.[options.name]?.projections && !item.providers?.[options.name]?.nativeReplacementRequested && !(options.name === "google" && item.providers?.google?.nativeRetained)) return Promise.resolve(false);
  let saves = Promise.resolve();
  let queued;
  const persist = () => {
    if (!queued) {
      queued = saves.then(() => {
        queued = void 0;
        return save();
      });
      saves = queued;
    }
    return queued;
  };
  const provider = original && {
    prepareCreate: original.prepareCreate && ((item2) => original.prepareCreate(item2)),
    read: original.read && ((...values) => measureSync(options.name, "read", () => original.read(...values))),
    create: (...values) => measureSync(options.name, "create", () => original.create(...values)),
    update: (...values) => measureSync(options.name, "update", () => original.update(...values)),
    delete: (...values) => measureSync(options.name, "delete", () => original.delete(...values))
  };
  return measureSync(options.name, "total", () => syncBatch(() => measureSync(options.name, "rolling", () => reconcileProjection(item, provider, persist, options))));
}
async function reconcileProjection(item, provider, persist, options) {
  const { name: name2, materialized } = options;
  if (name2 === "google" && item.providers?.google?.nativeRetained && item.providers.google.remoteId && item.desiredPublication?.google) return true;
  if (!materialized && !item.providers?.[name2]?.projections && !item.providers?.[name2]?.nativeReplacementRequested) return false;
  if (item.ownership !== "LOCAL") return true;
  const link = (item.providers ??= {})[name2] ??= { status: "pending" };
  if (name2 === "google" && options.explicitWithdrawal && item.desiredPublication?.google === false) {
    link.nativeWithdrawalRequested = true;
    await persist();
  }
  const desired = item.desiredPublication?.[name2] === true;
  const fail = (target, error) => {
    const failure = error;
    target.status = failure.code === "CONFLICT" || failure.code === "GOOGLE_PROJECTION_CONFLICT" || failure.status === 412 ? "conflict" : "error";
    target.lastError = error instanceof Error ? error.message : String(error);
    if (failure.code === "GOOGLE_PROJECTION_RETIRED" || failure.code === "DELETED_REMOTELY" || [404, 410].includes(failure.status ?? 0)) target.deletedRemotely = true;
  };
  if (link.uncertainCreate || desired && link.deletedRemotely && !options.retry) {
    fail(link, new Error(link.uncertainCreate ? `Cr\xE9ation native distante incertaine : ${name2 === "twitch" ? "v\xE9rifiez le planning dans Twitch. Aucune identit\xE9 candidate ne sera adopt\xE9e ou republi\xE9e automatiquement." : "r\xE9conciliez son identit\xE9 avant de mat\xE9rialiser."}` : "S\xE9rie supprim\xE9e \xE0 distance \u2014 retry explicite requis."));
    await persist();
    return true;
  }
  const entries = link.projections ??= {};
  const now = options.now ?? Date.now();
  const bounds2 = { from: new Date(now).toISOString(), nextCount: 7 };
  link.projectionWindow = bounds2;
  const recover = async (entry) => {
    if (!provider || !entry.uncertainCreate || name2 !== "google" || entry.event.projection?.mode !== "materialized") return;
    const original = request(entry.uncertainCreate.event, { ...entry, uncertainCreate: void 0 }, name2);
    try {
      const recovered = await provider.create(original);
      entry.remoteId = recovered.id;
      entry.remoteRevision = recovered.revision;
      entry.calendarId = recovered.calendarId ?? entry.calendarId;
    } catch (error) {
      if (error.code !== "GOOGLE_PROJECTION_RETIRED") throw error;
      entry.deletedRemotely = true;
      delete entry.remoteId;
      delete entry.remoteRevision;
    }
    delete entry.uncertainCreate;
    await persist();
  };
  const expected = /* @__PURE__ */ new Map();
  if (desired && materialized) {
    for (const occurrence of (options.expand ?? expandRecurringItems)([{ ...item, providers: void 0 }], {
      ...bounds2,
      accept: (occurrence2) => occurrence2.desiredPublication?.[name2] !== false && !(name2 === "google" && link.projectionRetirements?.[occurrence2.occurrenceKey]?.retained)
    })) {
      if (occurrence.occurrenceKey && expected.has(occurrence.occurrenceKey)) throw new Error("Duplicate projected occurrence identity");
      if (!occurrence.occurrenceKey) throw new Error("Le moteur doit fournir une occurrenceKey stable.");
      if (name2 === "google" && link.projectionRetirements?.[occurrence.occurrenceKey]?.retained) continue;
      if (occurrence.desiredPublication?.[name2] !== false && Date.parse(occurrence.endAtUtc) > now) {
        expected.set(occurrence.occurrenceKey, request(occurrence, { status: "pending", projectionOwned: true, calendarId: link.calendarId }, name2));
      }
    }
  }
  if (link.remoteId || name2 === "twitch" && item.twitchSegmentId) {
    if (link.status === "conflict" || item.conflict?.provider === name2) return true;
    if (!link.projectionOwned && !(name2 === "google" && !desired && link.nativeWithdrawalRequested) || !provider) {
      fail(link, new Error(`Retirez explicitement la publication ${name2} existante avant de mat\xE9rialiser cette s\xE9rie.`));
      await persist();
      return true;
    }
    try {
      if (name2 === "google") {
        link.nativeWithdrawalRequested = true;
        await persist();
      }
      if (name2 === "twitch" && provider.read) {
        const remote = await provider.read(link.remoteId ?? item.twitchSegmentId, item);
        if (!remote.deleted && link.fingerprint && remote.fingerprint !== link.fingerprint) {
          throw Object.assign(new Error("La s\xE9rie Twitch a chang\xE9 \xE0 distance. R\xE9solvez le conflit avant son remplacement."), { code: "CONFLICT" });
        }
      }
      await provider.delete(link.remoteId ?? item.twitchSegmentId, item, link.remoteRevision);
      delete link.remoteId;
      delete link.remoteRevision;
      delete link.fingerprint;
      delete link.nativeWithdrawalRequested;
      if (name2 === "twitch") {
        delete item.twitchSegmentId;
        item.twitchRecurring = false;
        if (materialized || !desired) delete link.nativeReplacementRequested;
      }
      await persist();
    } catch (error) {
      fail(link, error);
      await persist();
      return true;
    }
  }
  await boundedMap(Object.entries(entries), async ([key2, entry]) => {
    if (expected.has(key2) && !entry.pendingDeletion || entry.managedBy !== "StreamDashboard") return;
    try {
      if (name2 === "google") {
        entry.pendingDeletion = true;
        await persist();
        if (entry.status === "conflict") return;
      }
      await recover(entry);
      if (entry.uncertainCreate) throw new Error("Cr\xE9ation distante incertaine : identit\xE9 \xE0 r\xE9concilier avant nettoyage.");
      if (entry.remoteId) {
        if (!provider) throw new Error(`${name2} non connect\xE9.`);
        try {
          await provider.delete(entry.remoteId, request(entry.event, entry, name2), entry.remoteRevision);
        } catch (error) {
          if (![404, 410].includes(error.status ?? 0) && error.code !== "DELETED_REMOTELY") throw error;
        }
      }
      if (name2 === "google") (link.projectionRetirements ??= {})[key2] = { calendarId: entry.calendarId, creationId: randomUuid() };
      delete entries[key2];
      expected.delete(key2);
    } catch (error) {
      fail(entry, error);
    }
    await persist();
  });
  await boundedMap([...expected], async ([key2, event]) => {
    let entry = entries[key2];
    if (entry && entry.managedBy !== "StreamDashboard") return;
    if (!entry) {
      const retired = name2 === "google" ? link.projectionRetirements?.[key2] : void 0;
      entry = entries[key2] = {
        occurrenceKey: key2,
        managedBy: "StreamDashboard",
        event,
        status: "pending",
        projectionOwned: true,
        calendarId: retired?.calendarId ?? link.calendarId,
        accountId: link.accountId ?? Object.values(entries).find((value) => value.accountId)?.accountId,
        creationId: retired?.creationId
      };
      if (retired) delete link.projectionRetirements[key2];
    }
    try {
      if (entry.pendingDeletion) return;
      if (entry.status === "conflict") return;
      if (!provider) throw new Error(`${name2} non connect\xE9.`);
      await recover(entry);
      if (entry.uncertainCreate) throw new Error("Cr\xE9ation distante incertaine. R\xE9conciliez son identit\xE9 avant de republier.");
      let observed;
      if (entry.remoteId && provider.read) {
        const remote = observed = await provider.read(entry.remoteId, request(entry.event, entry, name2));
        if (remote.deleted) entry.deletedRemotely = true;
        else if (entry.fingerprint && remote.fingerprint && entry.fingerprint !== remote.fingerprint || name2 === "google" && entry.remoteRevision && remote.revision && entry.remoteRevision !== remote.revision) {
          throw Object.assign(new Error(`Occurrence modifi\xE9e \xE0 distance : conflit ${name2}.`), { code: "CONFLICT" });
        }
      }
      if (entry.deletedRemotely) {
        if (!options.retry) throw new Error("Occurrence supprim\xE9e \xE0 distance \u2014 retry explicite requis.");
        if (entry.remoteId && !provider.read) throw new Error("Lecture distante requise avant republication.");
        const remote = entry.remoteId ? observed ?? await provider.read(entry.remoteId, request(entry.event, entry, name2)) : void 0;
        if (!remote || remote.deleted) {
          delete entry.remoteId;
          delete entry.fingerprint;
          delete entry.remoteRevision;
          if (name2 === "google") entry.creationId = randomUuid();
        }
        entry.deletedRemotely = false;
      }
      const content = projectionContent(event, name2);
      const sameAppliedContent = entry.appliedContent === content || name2 === "twitch" && entry.appliedContent === projectionContent(entry.event) && projectionContent(entry.event, name2) === content;
      if (!entry.remoteId || !sameAppliedContent || entry.status !== "synced") {
        entry.status = "pending";
        if (entry.remoteId) await persist();
        const body = request(event, entry, name2);
        if (entry.remoteId) {
          const result = await provider.update(entry.remoteId, body, entry.remoteRevision);
          entry.fingerprint = result.fingerprint;
          entry.remoteRevision = result.revision;
        } else {
          const result = await createWithDurableIntent(body, name2, persist, (value) => provider.create(value), provider.prepareCreate);
          entry.calendarId = result.calendarId ?? entry.calendarId;
          entry.remoteId = result.id;
          entry.fingerprint = result.fingerprint;
          entry.remoteRevision = result.revision;
        }
        entry.event = { ...event, projection: body.projection };
        entry.appliedContent = content;
        entry.status = "synced";
        entry.lastSyncedAt = new Date(now).toISOString();
        delete entry.lastError;
      } else {
        entry.event = { ...event, projection: entry.event.projection ?? event.projection };
        entry.appliedContent = content;
        return;
      }
    } catch (error) {
      fail(entry, error);
    }
    await persist();
  });
  summarizeProjection(item, name2, now);
  await persist();
  if (!materialized && !Object.keys(entries).length) {
    delete link.projections;
    delete link.projectionWindow;
    await persist();
    return false;
  }
  return true;
}
function summarizeProjection(item, name2, now = Date.now()) {
  const link = item.providers[name2];
  const desired = item.desiredPublication?.[name2] === true;
  link.projectionMode = "materialized";
  const failures = Object.values(link.projections ?? {}).filter((entry) => entry.status === "error" || entry.status === "conflict");
  link.status = failures.length ? "error" : Object.values(link.projections ?? {}).some((entry) => entry.status === "pending") ? "pending" : desired ? "synced" : "not-published";
  if (failures.length) link.lastError = `${failures.length} occurrence(s) ${name2} en erreur : ${failures[0].lastError}`;
  else {
    delete link.lastError;
    link.deletedRemotely = false;
    link.lastSyncedAt = new Date(now).toISOString();
  }
  if (name2 === "twitch" && ["synced", "not-published"].includes(link.status)) delete item.syncError;
}

// integrations/google-calendar/src/projection.ts
function googleProjectionLocalId(identity2) {
  return identity2.mode === "master" ? identity2.seriesLocalId : `sd-occ-${createHash("sha256").update(JSON.stringify([identity2.seriesLocalId, identity2.occurrenceKey])).digest("hex")}`;
}
function projectGoogleSeries(item, window2, source = { expand: expandRecurringItems }) {
  if (item.seriesId || item.occurrenceKey) throw new Error("Une projection exige une s\xE9rie canonique.");
  const seriesLocalId = item.localId || item.id;
  if (!seriesLocalId) throw new Error("Identit\xE9 de s\xE9rie manquante.");
  if (item.recurrence) migrateRecurrence(item.recurrence);
  if (!Number.isFinite(Date.parse(item.startAtUtc)) || !Number.isFinite(Date.parse(item.endAtUtc)) || Date.parse(item.endAtUtc) <= Date.parse(item.startAtUtc)) throw new Error("Dates de s\xE9rie invalides.");
  if (item.recurrence) {
    if (!item.recurrence.timeZone) throw new Error("Fuseau de s\xE9rie requis.");
    new Intl.DateTimeFormat("en", { timeZone: item.recurrence.timeZone });
    if (item.recurrence.until && (!Number.isFinite(Date.parse(item.recurrence.until)) || Date.parse(item.recurrence.until) < Date.parse(item.startAtUtc))) throw new Error("Fin de s\xE9rie invalide.");
  }
  try {
    googleRecurrence(item);
    const identity2 = { mode: "master", seriesLocalId };
    return { mode: "master", entries: [{ identity: identity2, input: { ...item, localId: seriesLocalId, projection: identity2 } }] };
  } catch (error) {
    if (!item.recurrence) throw error;
  }
  const from = +new Date(window2.from);
  const to = window2.nextCount === void 0 ? +new Date(window2.to) : Infinity;
  if (!Number.isFinite(from) || window2.nextCount === void 0 && !Number.isFinite(to) || to <= from) throw new Error("Fen\xEAtre de projection invalide.");
  const keys = /* @__PURE__ */ new Set();
  const entries = source.expand([structuredClone(item)], window2).map((occurrence) => {
    const key2 = occurrence.occurrenceKey;
    const start = Date.parse(occurrence.startAtUtc);
    const end = Date.parse(occurrence.endAtUtc);
    if (!key2 || occurrence.seriesId !== item.id || keys.has(key2) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= to || end <= from) {
      throw new Error("Occurrence de projection invalide ou dupliqu\xE9e.");
    }
    keys.add(key2);
    assertGoogleMaterializedAllDay(occurrence);
    const identity2 = { mode: "materialized", seriesLocalId, occurrenceKey: key2 };
    const input = {
      localId: googleProjectionLocalId(identity2),
      projection: identity2,
      desiredPublication: structuredClone(occurrence.desiredPublication),
      title: occurrence.title,
      description: occurrence.description,
      startAtUtc: occurrence.startAtUtc,
      endAtUtc: occurrence.endAtUtc,
      allDay: occurrence.allDay
    };
    return { identity: identity2, input };
  });
  return { mode: "materialized", window: { from: window2.from, to: window2.to, nextCount: window2.nextCount }, entries };
}
function needsGoogleMaterialization(item) {
  if (!item.recurrence) return false;
  try {
    googleRecurrence(item);
    return false;
  } catch {
    return true;
  }
}
async function reconcileGoogleProjection(item, provider, persist, options = {}) {
  try {
    return await reconcileProviderProjection(item, provider, persist, {
      ...options,
      name: "google",
      materialized: needsGoogleMaterialization(item),
      expand: (items, window2) => items.flatMap((master) => projectGoogleSeries(master, window2).entries.map(({ input, identity: identity2 }) => ({
        ...master,
        ...input,
        recurrence: void 0,
        seriesId: void 0,
        occurrenceKey: identity2.mode === "materialized" ? identity2.occurrenceKey : void 0
      })))
    });
  } catch (error) {
    const link = (item.providers ??= {}).google ??= { status: "error" };
    link.status = "error";
    link.lastError = error.message;
    await persist();
    return true;
  }
}
async function resolveGoogleOccurrenceConflict(item, key2, strategy, provider, persist, restore) {
  const link = item.providers?.google;
  const entry = link?.projections?.[key2];
  if (item.ownership !== "LOCAL" || !entry || entry.managedBy !== "StreamDashboard" || entry.status !== "conflict") throw new Error("Aucun conflit Google pour cette occurrence.");
  try {
    if (entry.pendingDeletion) {
      if (!entry.remoteId || !provider?.read) throw new Error("Lecture Google requise pour r\xE9soudre le retrait.");
      const body = { ...entry.event, providers: { google: entry } };
      if (body.projection?.mode === "materialized") body.projection = { ...body.projection, creationId: entry.creationId };
      const latest2 = await provider.read(entry.remoteId, body);
      if (!latest2.deleted && (!latest2.remote || !latest2.revision)) throw new Error("Version Google distante indisponible.");
      if (strategy === "remote") {
        if (latest2.deleted) throw new Error("Occurrence d\xE9j\xE0 supprim\xE9e : confirmez le retrait local.");
        if (!restore) throw new Error("Restauration locale indisponible.");
        const restored = {
          ...entry.event,
          ...latest2.remote,
          id: `${item.id}::google-retained::${key2}`,
          projection: body.projection,
          recurrence: void 0,
          seriesId: void 0,
          occurrenceKey: void 0,
          desiredPublication: { local: true, twitch: false, google: true },
          ownership: "LOCAL",
          editable: true,
          providers: { google: { status: "synced", remoteId: entry.remoteId, calendarId: entry.calendarId, remoteRevision: latest2.revision } }
        };
        restore(restored);
        (link.projectionRetirements ??= {})[key2] = { calendarId: entry.calendarId, creationId: entry.creationId ?? randomUuid(), retained: true };
        delete link.projections[key2];
      } else {
        entry.remoteRevision = latest2.revision ?? entry.remoteRevision;
        entry.deletionDecision = "delete";
        entry.status = "pending";
        delete entry.lastError;
      }
      summarizeProjection(item, "google");
      await persist();
      return;
    }
    if (!item.recurrence || !link?.projectionWindow || !item.desiredPublication?.google || !entry.remoteId || !provider?.read) throw new Error("Occurrence Google inactive ou lecture indisponible.");
    const latest = await provider.read(entry.remoteId, { ...entry.event, providers: { google: entry } });
    if (latest.deleted) throw Object.assign(new Error("Occurrence supprim\xE9e \xE0 distance \u2014 retry explicite requis."), { code: "DELETED_REMOTELY" });
    if (!latest.remote || !latest.revision) throw new Error("Version Google distante indisponible.");
    const projected = projectGoogleSeries(item, { ...link.projectionWindow, accept: (occurrence) => occurrence.desiredPublication?.google !== false && !link.projectionRetirements?.[occurrence.occurrenceKey]?.retained }).entries.find((value) => value.identity.mode === "materialized" && value.identity.occurrenceKey === key2);
    if (!projected) throw new Error("Occurrence hors fen\xEAtre : actualisez la projection.");
    let event = { ...entry.event, ...projected.input };
    if (event.projection?.mode === "materialized") event.projection = { ...event.projection, creationId: entry.creationId };
    entry.remoteRevision = latest.revision;
    await persist();
    if (strategy === "local") {
      const result = await provider.update(entry.remoteId, { ...event, providers: { google: entry } }, latest.revision);
      entry.remoteRevision = result.revision;
    } else {
      const patch = {
        title: latest.remote.title,
        description: latest.remote.description,
        startAtUtc: latest.remote.startAtUtc,
        endAtUtc: latest.remote.endAtUtc,
        allDay: latest.remote.allDay
      };
      assertGoogleMaterializedAllDay({ ...event, ...patch });
      const exceptions = item.recurrence.exceptions ??= {};
      exceptions[key2] = { ...exceptions[key2], patch: { ...exceptions[key2]?.patch, ...patch } };
      event = { ...event, ...patch };
    }
    entry.event = event;
    entry.appliedContent = projectionContent(event);
    entry.status = "synced";
    entry.deletedRemotely = false;
    delete entry.lastError;
    summarizeProjection(item, "google");
    await persist();
  } catch (error) {
    entry.deletedRemotely = error.code === "DELETED_REMOTELY";
    entry.status = entry.deletedRemotely ? "error" : "conflict";
    entry.lastError = error.message;
    summarizeProjection(item, "google");
    await persist();
    throw error;
  }
}

// integrations/twitch/src/projection.ts
function needsTwitchMaterialization(item) {
  if (!item.recurrence) return false;
  try {
    assertTwitchRecurrence(item);
    return false;
  } catch {
    return true;
  }
}
function request2(event, link) {
  const { recurrence, seriesId, occurrenceKey, providers, conflict, twitchSegmentId, ...body } = event;
  return { ...body, twitchRecurring: false, providers: { twitch: link } };
}
async function reconcileTwitchProjection(item, provider, persist, options = {}) {
  try {
    return await reconcileProviderProjection(item, provider, persist, { ...options, name: "twitch", materialized: needsTwitchMaterialization(item), expand: options.expand ?? expandRecurringItems });
  } catch (error) {
    const link = (item.providers ??= {}).twitch ??= { status: "error" };
    link.status = "error";
    link.lastError = error.message;
    await persist();
    return true;
  }
}
async function resolveTwitchOccurrenceConflict(item, key2, strategy, provider, persist) {
  const link = item.providers?.twitch;
  const entry = link?.projections?.[key2];
  if (item.ownership !== "LOCAL" || !entry || entry.managedBy !== "StreamDashboard" || entry.status !== "conflict") {
    throw new Error("Aucun conflit Twitch \xE0 r\xE9soudre pour cette occurrence.");
  }
  try {
    if (!item.recurrence || !link?.projectionWindow || !item.desiredPublication?.twitch) throw new Error("Occurrence inactive : actualisez la projection Twitch.");
    if (!provider?.read || !entry.remoteId) throw new Error("Lecture distante Twitch requise pour r\xE9soudre cette occurrence.");
    const latest = await provider.read(entry.remoteId, request2(entry.event, entry));
    if (latest.deleted) throw Object.assign(new Error("Occurrence supprim\xE9e \xE0 distance \u2014 retry explicite requis."), { code: "DELETED_REMOTELY" });
    if (!latest.remote || !latest.fingerprint) throw new Error("Version ou empreinte distante indisponible.");
    const occurrence = expandRecurringItems([{ ...item, providers: void 0 }], { ...link.projectionWindow, accept: (occurrence2) => occurrence2.desiredPublication?.twitch !== false }).find((value) => value.occurrenceKey === key2);
    if (!occurrence) throw new Error("Occurrence hors fen\xEAtre : actualisez la projection Twitch.");
    entry.fingerprint = latest.fingerprint;
    entry.remoteRevision = latest.revision;
    await persist();
    let event = request2(occurrence, { status: "pending", projectionOwned: true });
    if (strategy === "local") {
      const result = await provider.update(entry.remoteId, request2(event, entry), entry.remoteRevision);
      entry.fingerprint = result.fingerprint;
      entry.remoteRevision = result.revision;
    } else {
      const remote = latest.remote;
      const patch = {
        title: remote.title,
        startAtUtc: remote.startAtUtc,
        endAtUtc: remote.endAtUtc,
        twitchCategoryId: remote.twitchCategoryId ?? "",
        twitchCategoryName: remote.twitchCategoryName ?? ""
      };
      const exceptions = item.recurrence.exceptions ??= {};
      exceptions[key2] = { ...exceptions[key2], patch: { ...exceptions[key2]?.patch, ...patch } };
      event = { ...event, ...patch };
    }
    entry.event = event;
    entry.appliedContent = projectionContent(event, "twitch");
    entry.status = "synced";
    entry.deletedRemotely = false;
    entry.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
    delete entry.lastError;
    summarizeProjection(item, "twitch");
    await persist();
  } catch (error) {
    const deleted = error.code === "DELETED_REMOTELY";
    entry.status = deleted ? "error" : "conflict";
    if (deleted) entry.deletedRemotely = true;
    entry.lastError = error instanceof Error ? error.message : String(error);
    summarizeProjection(item, "twitch");
    await persist();
    throw error;
  }
}

// packages/core/src/planning.ts
function providerSupportsRecurrence(provider, item) {
  if (provider === "google") {
    try {
      googleRecurrence(item);
      return true;
    } catch {
      return false;
    }
  }
  try {
    assertTwitchRecurrence(item);
    return true;
  } catch {
    return false;
  }
}
var PlanningOrchestrator = class {
  constructor(items, providers, persist) {
    this.items = items;
    this.providers = providers;
    this.persist = persist;
  }
  items;
  providers;
  persist;
  queue = Promise.resolve();
  refreshTwitch(now = Date.now(), ids) {
    return this.serial(async () => {
      for (const item of this.items.filter((item2) => item2.deletionPending && (!ids || ids.includes(item2.id)))) {
        await recoverSeriesDeletionIdentities(item, this.providers, () => this.persist(this.items));
      }
      for (const item of this.items.filter((item2) => !ids || ids.includes(item2.id))) {
        if (item.deletionPending) continue;
        const transitioning = (item.providers?.twitch?.projectionMode === "materialized" || Boolean(item.providers?.twitch?.nativeReplacementRequested)) && !needsTwitchMaterialization(item);
        const handled = await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items), { now });
        if (!handled && transitioning && item.ownership === "LOCAL" && item.desiredPublication?.twitch && !this.remoteId(item, "twitch") && item.conflict?.provider !== "twitch") {
          await this.publishOne(item, "twitch");
        }
      }
      for (const item of this.items.filter((item2) => !ids || ids.includes(item2.id))) {
        if (item.deletionPending) continue;
        const transitioning = item.providers?.google?.projectionMode === "materialized" && !needsGoogleMaterialization(item);
        const handled = await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { now });
        if (!handled && transitioning && item.ownership === "LOCAL" && item.desiredPublication?.google && !this.remoteId(item, "google")) await this.publishOne(item, "google");
      }
      return this.all();
    });
  }
  all() {
    return structuredClone(this.items);
  }
  create(input) {
    return this.serial(async () => {
      const id = input.id ?? randomUuid();
      const item = {
        ...input,
        recurrence: recurrenceForNewSeries(input.recurrence, input.localId ?? id),
        id,
        localId: input.localId ?? id,
        ownership: "LOCAL",
        editable: true,
        desiredPublication: input.desiredPublication ?? { local: true, twitch: false, google: false },
        providers: input.providers ?? {}
      };
      this.items.push(item);
      await this.persist(this.items);
      await this.reconcileDesiredPublication(item);
      return structuredClone(item);
    });
  }
  update(id, changes, options = {}) {
    return this.serial(async () => {
      const item = this.required(id);
      if (item.deletionPending) throw new Error("Suppression de s\xE9rie en attente. R\xE9essayez la suppression.");
      const twitchLink = item.providers?.twitch;
      const next = { ...item, ...changes };
      if (twitchLink?.remoteId && twitchLink.projectionOwned && twitchLink.projectionMode === "native" && (Boolean(item.recurrence) !== Boolean(next.recurrence) || item.recurrence && (Date.parse(item.startAtUtc) !== Date.parse(next.startAtUtc) || item.recurrence.timeZone !== next.recurrence?.timeZone) || needsTwitchMaterialization(next))) {
        twitchLink.nativeReplacementRequested ??= { recurrence: structuredClone(item.recurrence) };
      }
      Object.assign(item, changes);
      if (item.providers?.google) delete item.providers.google.nativeRetained;
      if (options.desiredPublication) {
        item.desiredPublication = {
          local: true,
          twitch: options.desiredPublication.twitch ?? item.desiredPublication?.twitch ?? false,
          google: options.desiredPublication.google ?? item.desiredPublication?.google ?? false
        };
      }
      await this.persist(this.items);
      await this.reconcileDesiredPublication(item, options.confirmRecurring === true, true);
      return structuredClone(item);
    });
  }
  remove(id, destinations) {
    return this.serial(async () => {
      const item = this.items.find((value) => value.id === id);
      if (!item) return this.all();
      if (destinations.local && (item.recurrence || item.deletionPending)) {
        if (item.twitchRecurring && !destinations.confirmRecurring && !item.deletionPending) throw new Error("Suppression explicite de la s\xE9rie Twitch r\xE9currente requise.");
        const retry = item.deletionPending === true;
        item.deletionPending = true;
        item.desiredPublication = { local: true, twitch: false, google: false };
        await this.persist(this.items);
        await this.finishSeriesDeletion(item, retry);
        return this.all();
      }
      const failed = [];
      for (const name2 of ["twitch", "google"]) {
        if (!destinations[name2]) continue;
        const remoteId = this.remoteId(item, name2);
        if (!remoteId) {
          if (!await this.unpublishOne(item, name2)) failed.push(name2);
          continue;
        }
        if (name2 === "twitch" && item.twitchRecurring && !destinations.confirmRecurring) {
          throw new Error("Suppression explicite de la s\xE9rie Twitch r\xE9currente requise.");
        }
        if (!await this.unpublishOne(item, name2)) failed.push(name2);
      }
      if (failed.length && destinations.local) {
        await this.persist(this.items);
        throw new Error(`Suppression distante incompl\xE8te (${failed.join(", ")}). L\u2019\xE9v\xE9nement local est conserv\xE9 pour permettre un retry.`);
      }
      if (destinations.local) this.items = this.items.filter((value) => value.id !== id);
      await this.persist(this.items);
      return this.all();
    });
  }
  retry(id, provider, options = {}) {
    return this.serial(async () => {
      const item = this.required(id);
      if (item.deletionPending) {
        await this.finishSeriesDeletion(item, true);
        return structuredClone(item);
      }
      if (provider === "twitch" && await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items), { retry: true })) {
        if (["error", "conflict"].includes(item.providers?.twitch?.status ?? "")) throw new Error(item.providers?.twitch?.lastError);
        return structuredClone(item);
      }
      if (provider === "google" && await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { retry: true })) {
        if (["error", "conflict"].includes(item.providers?.google?.status ?? "")) throw new Error(item.providers?.google?.lastError);
        return structuredClone(item);
      }
      if (!this.remoteId(item, provider)) assertProviderCreationCertain(item, provider);
      const desired = item.desiredPublication?.[provider] ?? false;
      if (desired && !providerSupportsRecurrence(provider, item)) {
        item.providers ??= {};
        const link = item.providers[provider] ??= { status: "error" };
        link.status = "error";
        link.lastError = `La r\xE9currence locale ne peut pas encore \xEAtre repr\xE9sent\xE9e fid\xE8lement sur ${provider}. L\u2019\xE9v\xE9nement local est conserv\xE9.`;
        await this.persist(this.items);
        throw new Error(link.lastError);
      }
      if (desired && (item.conflict?.provider === provider || item.providers?.[provider]?.status === "conflict")) {
        throw new Error(`Conflit ${provider} non r\xE9solu \u2014 choisissez d\u2019abord la version locale ou distante.`);
      }
      if (!desired) {
        const remoteId = this.remoteId(item, provider);
        if (!remoteId) {
          item.providers ??= {};
          const link = item.providers[provider] ??= { status: "not-published" };
          link.status = "not-published";
          link.deletedRemotely = false;
          delete link.lastError;
          await this.persist(this.items);
          return structuredClone(item);
        }
        if (provider === "twitch" && item.twitchRecurring && !options.confirmRecurring) {
          throw new Error("Suppression explicite de la s\xE9rie Twitch r\xE9currente requise.");
        }
        if (!await this.unpublishOne(item, provider)) {
          throw new Error(item.providers?.[provider]?.lastError ?? `Impossible de retirer la publication ${provider}.`);
        }
        return structuredClone(item);
      }
      await this.publishOne(item, provider, true);
      const currentLink = item.providers?.[provider];
      if (currentLink?.status !== "synced") {
        throw new Error(currentLink?.lastError ?? `Impossible de republier sur ${provider}.`);
      }
      return structuredClone(item);
    });
  }
  resolveConflict(id, provider, strategy, occurrenceKey) {
    return this.serial(async () => {
      const item = this.required(id);
      if (item.deletionPending) throw new Error("Suppression de s\xE9rie en attente : r\xE9essayez la suppression pour confirmer le retrait de la version distante courante.");
      if (occurrenceKey !== void 0) {
        if (provider === "google") await resolveGoogleOccurrenceConflict(item, occurrenceKey, strategy, this.providers.google, () => this.persist(this.items), (restored) => this.items.push(restored));
        else await resolveTwitchOccurrenceConflict(item, occurrenceKey, strategy, this.providers.twitch, () => this.persist(this.items));
        return structuredClone(item);
      }
      const conflict = item.conflict?.provider === provider ? item.conflict : item.providers?.[provider]?.status === "conflict" ? { provider, detectedAt: (/* @__PURE__ */ new Date()).toISOString() } : void 0;
      if (conflict) item.conflict = conflict;
      if (!conflict || conflict.provider !== provider) throw new Error(`Aucun conflit ${provider} \xE0 r\xE9soudre.`);
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: "conflict" };
      const remoteId = this.remoteId(item, provider);
      const remoteProvider = this.providers[provider];
      if (remoteId && remoteProvider?.read) {
        try {
          const latest = await remoteProvider.read(remoteId, item, { resolveConflict: true });
          if (latest.deleted) {
            link.deletedRemotely = true;
            throw new Error("\xC9v\xE9nement supprim\xE9 \xE0 distance. Confirmez explicitement sa republication.");
          }
          if (!latest.remote) throw new Error("Version distante indisponible pour r\xE9soudre ce conflit.");
          if (provider === "google" && link.nativeWithdrawalRequested && !latest.revision) throw new Error("ETag Google courant indisponible.");
          conflict.remote = latest.remote;
          if (latest.revision !== void 0) link.remoteRevision = latest.revision;
          if (latest.fingerprint !== void 0) link.fingerprint = latest.fingerprint;
          await this.persist(this.items);
        } catch (error) {
          link.status = "conflict";
          link.lastError = error instanceof Error ? error.message : String(error);
          await this.persist(this.items);
          throw error;
        }
      }
      if (provider === "twitch" && link.nativeReplacementRequested) {
        if (strategy === "remote") {
          if (!conflict.remote) throw new Error("Version distante indisponible.");
          Object.assign(item, conflict.remote);
          item.recurrence = link.nativeReplacementRequested.recurrence;
          item.desiredPublication = { local: true, google: false, ...item.desiredPublication, twitch: true };
          delete link.nativeReplacementRequested;
          delete link.projections;
          delete link.projectionWindow;
          link.status = "synced";
        } else link.status = "pending";
        delete item.conflict;
        delete link.lastError;
        await this.persist(this.items);
        return structuredClone(item);
      }
      if (provider === "google" && link.nativeWithdrawalRequested) {
        if (!remoteId || !remoteProvider?.read || !link.remoteRevision) throw new Error("Identit\xE9 et ETag Google requis pour r\xE9soudre le retrait.");
        if (strategy === "remote") {
          if (!conflict.remote) throw new Error("Version distante indisponible.");
          Object.assign(item, conflict.remote);
          item.desiredPublication = { local: true, twitch: false, ...item.desiredPublication, google: true };
          delete link.nativeWithdrawalRequested;
          link.nativeRetained = true;
          link.projectionMode = "native";
          if (!Object.keys(link.projections ?? {}).length) {
            delete link.projections;
            delete link.projectionWindow;
          }
          link.status = "synced";
        } else {
          link.status = "pending";
        }
        delete item.conflict;
        delete link.lastError;
        link.deletedRemotely = false;
        await this.persist(this.items);
        return structuredClone(item);
      }
      if (strategy === "remote") {
        if (!conflict.remote) throw new Error("Version distante indisponible pour r\xE9soudre ce conflit.");
        Object.assign(item, conflict.remote);
        delete link.uncertainCreate;
        delete item.conflict;
        link.status = "synced";
        link.deletedRemotely = false;
        link.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
        delete link.lastError;
        await this.persist(this.items);
        return structuredClone(item);
      }
      if (!remoteId) throw new Error(`Objet distant ${provider} introuvable pour appliquer la version locale.`);
      if (!remoteProvider) {
        link.status = "conflict";
        link.lastError = `${provider} non connect\xE9. Le conflit reste ouvert.`;
        await this.persist(this.items);
        throw new Error(link.lastError);
      }
      link.deletedRemotely = false;
      link.status = "pending";
      await this.persist(this.items);
      try {
        const result = await remoteProvider.update(remoteId, item, link.remoteRevision);
        delete link.uncertainCreate;
        if (result.revision !== void 0) link.remoteRevision = result.revision;
        if (provider === "twitch") link.fingerprint = result.fingerprint;
        link.status = "synced";
        link.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
        link.deletedRemotely = false;
        delete link.lastError;
        delete item.conflict;
        await this.persist(this.items);
      } catch (error) {
        link.status = "conflict";
        link.lastError = error instanceof Error ? error.message : String(error);
        await this.persist(this.items);
        throw error;
      }
      return structuredClone(item);
    });
  }
  markRemoteDeleted(id, provider) {
    return this.serial(async () => {
      const item = this.required(id);
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: "error" };
      link.deletedRemotely = true;
      link.status = "error";
      link.lastError = "\xC9v\xE9nement supprim\xE9 \xE0 distance \u2014 action utilisateur requise.";
      await this.persist(this.items);
      return structuredClone(item);
    });
  }
  markConflict(id, provider, remote) {
    return this.serial(async () => {
      const item = this.required(id);
      item.conflict = { provider, detectedAt: (/* @__PURE__ */ new Date()).toISOString(), remote };
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: "conflict" };
      link.status = "conflict";
      link.lastError = "Conflit avec une modification distante.";
      await this.persist(this.items);
      return structuredClone(item);
    });
  }
  async finishSeriesDeletion(item, retry = false) {
    await deleteSeriesProjections(item, this.providers, () => this.persist(this.items), retry);
    this.items = this.items.filter((value) => value.id !== item.id);
    await this.persist(this.items);
  }
  async reconcileDesiredPublication(item, confirmRecurring = false, updateLinked = false) {
    for (const name2 of ["twitch", "google"]) {
      const desired = item.desiredPublication?.[name2] ?? false;
      if (name2 === "twitch" && await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items))) continue;
      if (name2 === "google" && await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { explicitWithdrawal: !desired })) continue;
      const remoteId = this.remoteId(item, name2);
      if (!remoteId && item.providers?.[name2]?.uncertainCreate) {
        const link2 = item.providers[name2];
        link2.status = "error";
        link2.lastError = "Cr\xE9ation distante incertaine. R\xE9conciliez son identit\xE9 avant de republier.";
        await this.persist(this.items);
        continue;
      }
      if (desired && !providerSupportsRecurrence(name2, item)) {
        item.providers ??= {};
        const link2 = item.providers[name2] ??= { status: "error" };
        link2.status = "error";
        link2.lastError = `La r\xE9currence locale ne peut pas encore \xEAtre repr\xE9sent\xE9e fid\xE8lement sur ${name2}. L\u2019\xE9v\xE9nement local est conserv\xE9.`;
        await this.persist(this.items);
        continue;
      }
      if (!desired) {
        if (!remoteId) {
          item.providers ??= {};
          const link2 = item.providers[name2] ??= { status: "not-published" };
          link2.status = "not-published";
          link2.deletedRemotely = false;
          delete link2.lastError;
          await this.persist(this.items);
          continue;
        }
        if (name2 === "twitch" && item.twitchRecurring && !confirmRecurring) {
          const link2 = this.ensureLink(item, name2, remoteId);
          link2.status = "error";
          link2.lastError = "Cette publication Twitch appartient \xE0 une s\xE9rie r\xE9currente. Confirmation requise pour la retirer.";
          await this.persist(this.items);
          continue;
        }
        await this.unpublishOne(item, name2);
        continue;
      }
      const link = item.providers?.[name2];
      if (item.conflict?.provider === name2) {
        if (link) {
          link.status = "conflict";
          link.lastError = "Conflit distant non r\xE9solu \u2014 choisissez la version \xE0 conserver.";
          await this.persist(this.items);
        }
        continue;
      }
      if (!remoteId) {
        await this.publishOne(item, name2, name2 !== "twitch");
        continue;
      }
      if (updateLinked) await this.publishOne(item, name2);
    }
  }
  async publishOne(item, name2, explicitRetry = false) {
    const desired = item.desiredPublication?.[name2] ?? false;
    item.providers ??= {};
    const existingRemoteId = this.remoteId(item, name2);
    const link = item.providers[name2] ??= { status: desired ? "pending" : "not-published" };
    if (existingRemoteId && !link.remoteId) link.remoteId = existingRemoteId;
    if (!desired) {
      if (!existingRemoteId) link.status = "not-published";
      return;
    }
    if (link.deletedRemotely && !explicitRetry) return;
    if (!this.remoteId(item, name2)) {
      try {
        assertProviderCreationCertain(item, name2);
      } catch (error) {
        link.status = "error";
        link.lastError = error.message;
        await this.persist(this.items);
        return;
      }
    }
    link.status = "pending";
    if (explicitRetry) delete link.lastError;
    await this.persist(this.items);
    await this.attempt(item, name2, async (remoteProvider) => {
      if (explicitRetry && link.deletedRemotely) {
        const previousId = this.remoteId(item, name2);
        const remote = previousId && remoteProvider.read ? await remoteProvider.read(previousId, item) : void 0;
        if (!remote || remote.deleted) this.clearRemoteIdentity(item, name2);
        link.deletedRemotely = false;
        await this.persist(this.items);
      }
      const remoteId = this.remoteId(item, name2);
      if (remoteId) {
        const result = await remoteProvider.update(remoteId, item, link.remoteRevision);
        delete link.uncertainCreate;
        if (result.revision !== void 0) link.remoteRevision = result.revision;
        if (name2 === "twitch") link.fingerprint = result.fingerprint;
      } else {
        const result = await createWithDurableIntent(item, name2, () => this.persist(this.items), (request3) => remoteProvider.create(request3), remoteProvider.prepareCreate);
        delete link.nativeReplacementRequested;
        link.projectionOwned = result.owned !== false;
        link.projectionMode = "native";
        link.remoteId = result.id;
        if (result.revision !== void 0) link.remoteRevision = result.revision;
        if (name2 === "twitch") link.fingerprint = result.fingerprint;
        link.calendarId = result.calendarId ?? link.calendarId;
        if (name2 === "twitch") {
          link.projectionMode = "native";
          link.projectionOwned = result.owned !== false;
          item.twitchSegmentId = result.id;
          item.twitchRecurring = item.recurrence ? item.recurrence.frequency === "weekly" && item.recurrence.interval === 1 : item.twitchRecurring === true;
        }
      }
    });
  }
  async unpublishOne(item, name2) {
    const remoteId = this.remoteId(item, name2);
    if (name2 === "google") {
      const link2 = this.ensureLink(item, name2, remoteId);
      item.desiredPublication ??= { local: true, twitch: false, google: false };
      item.desiredPublication.google = false;
      link2.nativeWithdrawalRequested = true;
      delete link2.nativeRetained;
      await this.persist(this.items);
    }
    if (name2 === "twitch") {
      item.desiredPublication ??= { local: true, twitch: false, google: false };
      item.desiredPublication.twitch = false;
      await this.persist(this.items);
    }
    if (name2 === "twitch" && (!remoteId || item.providers?.twitch?.projectionOwned) && (needsTwitchMaterialization(item) || item.providers?.twitch?.projections)) {
      await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items));
      return !["error", "conflict"].includes(item.providers?.twitch?.status ?? "");
    }
    if (name2 === "google" && item.providers?.google?.projections) {
      item.desiredPublication ??= { local: true, twitch: false, google: false };
      item.desiredPublication.google = false;
      await this.persist(this.items);
      await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { explicitWithdrawal: true });
      return !["error", "conflict"].includes(item.providers.google.status);
    }
    if (!remoteId) {
      if (name2 === "twitch") {
        assertProviderCreationCertain(item, name2);
        item.twitchRecurring = false;
      }
      return true;
    }
    const link = this.ensureLink(item, name2, remoteId);
    if (name2 === "google" && link.status === "conflict") return false;
    link.status = "pending";
    await this.persist(this.items);
    const ok = await this.attempt(item, name2, (remoteProvider) => remoteProvider.delete(remoteId, item, link.remoteRevision));
    if (ok) {
      delete link.deletionPeriod;
      delete link.nativeWithdrawalRequested;
      if (name2 === "twitch") item.twitchRecurring = false;
      this.clearRemoteIdentity(item, name2);
      link.status = "not-published";
      link.deletedRemotely = false;
      delete link.lastError;
      if (item.conflict?.provider === name2) delete item.conflict;
      await this.persist(this.items);
      if (name2 === "twitch" && item.providers?.twitch?.projections) {
        await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items));
        return !["error", "conflict"].includes(item.providers.twitch.status);
      }
    }
    return ok;
  }
  async attempt(item, name2, operation) {
    const link = item.providers[name2];
    const provider = this.providers[name2];
    if (!provider) {
      link.status = "error";
      link.lastError = `${name2} non connect\xE9.`;
      await this.persist(this.items);
      return false;
    }
    try {
      await operation(provider);
      link.status = "synced";
      link.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
      link.deletedRemotely = false;
      delete link.lastError;
      if (name2 === "twitch") delete item.syncError;
      await this.persist(this.items);
      return true;
    } catch (error) {
      const failure = error;
      link.status = failure.code === "CONFLICT" || failure.status === 412 ? "conflict" : "error";
      if (link.status === "conflict") {
        item.conflict = { provider: name2, detectedAt: (/* @__PURE__ */ new Date()).toISOString(), remote: failure.remote };
        if (failure.fingerprint) link.fingerprint = failure.fingerprint;
      }
      if ((failure.code === "DELETED_REMOTELY" || failure.status === 404 || failure.status === 410) && (name2 !== "twitch" || this.remoteId(item, name2))) link.deletedRemotely = true;
      link.lastError = error instanceof Error ? error.message : String(error);
      await this.persist(this.items);
      return false;
    }
  }
  remoteId(item, name2) {
    return item.providers?.[name2]?.remoteId ?? (name2 === "twitch" ? item.twitchSegmentId : void 0);
  }
  ensureLink(item, name2, remoteId) {
    item.providers ??= {};
    const link = item.providers[name2] ??= { status: remoteId ? "synced" : "not-published" };
    if (remoteId && !link.remoteId) link.remoteId = remoteId;
    return link;
  }
  clearRemoteIdentity(item, name2) {
    const link = item.providers?.[name2];
    if (link) {
      delete link.remoteId;
      delete link.remoteRevision;
    }
    if (name2 === "twitch") {
      delete item.twitchSegmentId;
      delete link?.fingerprint;
    }
  }
  required(id) {
    const item = this.items.find((value) => value.id === id);
    if (!item) throw new Error("\xC9v\xE9nement introuvable.");
    return item;
  }
  serial(fn) {
    const result = this.queue.then(fn);
    this.queue = result.then(() => void 0, () => void 0);
    return result;
  }
};

// packages/core/src/product-profile.ts
var PROFILE_VERSION = 1;
var defaultProductProfile = () => ({
  version: PROFILE_VERSION,
  profile: { displayName: "Streamer", channelName: "", language: "fr" },
  modules: { obs: true, twitch: true, planning: true, notes: true, checklist: true, templates: true, automations: true, soundboard: true, streamerPings: true, googleCalendar: false, discord: false, streamlabs: false, wizebot: false },
  appearance: { theme: "system", preset: "minimal", accent: "#2474e5", density: "normal", radius: "medium", textScale: "normal" },
  mobile: { notifications: true, haptics: true },
  providers: { twitch: { mode: "official" }, google: { mode: "official" }, discord: { mode: "official" }, streamlabs: { mode: "custom" }, wizebot: { mode: "custom" } },
  onboarding: { completed: false },
  obs: { scenes: [], quickActions: [] }
});
var forbidden = /(?:token|secret|password|credential|authorization|refreshToken|accessToken)/i;
function assertSecretFree(value, at = "profile") {
  if (!value || typeof value !== "object") return;
  for (const [key2, child] of Object.entries(value)) {
    if (forbidden.test(key2)) throw new Error(`Le profil ne peut pas contenir de secret (${at}.${key2}).`);
    assertSecretFree(child, `${at}.${key2}`);
  }
}
var plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function validateProductProfile(value) {
  if (!plainObject(value)) throw new Error("Profil invalide.");
  if (value.version !== 1) throw new Error(`Version de profil non prise en charge: ${String(value.version)}.`);
  assertSecretFree(value);
  const result = structuredClone(defaultProductProfile());
  for (const key2 of ["profile", "modules", "appearance", "mobile", "providers", "onboarding", "obs"]) if (plainObject(value[key2])) Object.assign(result[key2], value[key2]);
  for (const id of Object.keys(result.modules)) if (typeof result.modules[id] !== "boolean") throw new Error(`Module invalide: ${id}.`);
  if (!/^#[0-9a-f]{6}$/i.test(result.appearance.accent)) throw new Error("La couleur principale doit utiliser le format #RRGGBB.");
  if (!["system", "light", "dark", "oled"].includes(result.appearance.theme)) throw new Error("Th\xE8me invalide.");
  const dependencies = { soundboard: ["obs"], streamerPings: ["twitch"], googleCalendar: ["planning"] };
  for (const [id, required] of Object.entries(dependencies)) if (result.modules[id]) {
    for (const dependency of required) if (!result.modules[dependency]) throw new Error(`${id} n\xE9cessite le module ${dependency}.`);
  }
  return result;
}

// node_modules/entities/dist/esm/generated/decode-data-html.js
var htmlDecodeTree = /* @__PURE__ */ new Uint16Array(
  // prettier-ignore
  /* @__PURE__ */ '\u1D41<\xD5\u0131\u028A\u049D\u057B\u05D0\u0675\u06DE\u07A2\u07D6\u080F\u0A4A\u0A91\u0DA1\u0E6D\u0F09\u0F26\u10CA\u1228\u12E1\u1415\u149D\u14C3\u14DF\u1525\0\0\0\0\0\0\u156B\u16CD\u198D\u1C12\u1DDD\u1F7E\u2060\u21B0\u228D\u23C0\u23FB\u2442\u2824\u2912\u2D08\u2E48\u2FCE\u3016\u32BA\u3639\u37AC\u38FE\u3A28\u3A71\u3AE0\u3B2E\u0800EMabcfglmnoprstu\\bfms\x7F\x84\x8B\x90\x95\x98\xA6\xB3\xB9\xC8\xCFlig\u803B\xC6\u40C6P\u803B&\u4026cute\u803B\xC1\u40C1reve;\u4102\u0100iyx}rc\u803B\xC2\u40C2;\u4410r;\uC000\u{1D504}rave\u803B\xC0\u40C0pha;\u4391acr;\u4100d;\u6A53\u0100gp\x9D\xA1on;\u4104f;\uC000\u{1D538}plyFunction;\u6061ing\u803B\xC5\u40C5\u0100cs\xBE\xC3r;\uC000\u{1D49C}ign;\u6254ilde\u803B\xC3\u40C3ml\u803B\xC4\u40C4\u0400aceforsu\xE5\xFB\xFE\u0117\u011C\u0122\u0127\u012A\u0100cr\xEA\xF2kslash;\u6216\u0176\xF6\xF8;\u6AE7ed;\u6306y;\u4411\u0180crt\u0105\u010B\u0114ause;\u6235noullis;\u612Ca;\u4392r;\uC000\u{1D505}pf;\uC000\u{1D539}eve;\u42D8c\xF2\u0113mpeq;\u624E\u0700HOacdefhilorsu\u014D\u0151\u0156\u0180\u019E\u01A2\u01B5\u01B7\u01BA\u01DC\u0215\u0273\u0278\u027Ecy;\u4427PY\u803B\xA9\u40A9\u0180cpy\u015D\u0162\u017Aute;\u4106\u0100;i\u0167\u0168\u62D2talDifferentialD;\u6145leys;\u612D\u0200aeio\u0189\u018E\u0194\u0198ron;\u410Cdil\u803B\xC7\u40C7rc;\u4108nint;\u6230ot;\u410A\u0100dn\u01A7\u01ADilla;\u40B8terDot;\u40B7\xF2\u017Fi;\u43A7rcle\u0200DMPT\u01C7\u01CB\u01D1\u01D6ot;\u6299inus;\u6296lus;\u6295imes;\u6297o\u0100cs\u01E2\u01F8kwiseContourIntegral;\u6232eCurly\u0100DQ\u0203\u020FoubleQuote;\u601Duote;\u6019\u0200lnpu\u021E\u0228\u0247\u0255on\u0100;e\u0225\u0226\u6237;\u6A74\u0180git\u022F\u0236\u023Aruent;\u6261nt;\u622FourIntegral;\u622E\u0100fr\u024C\u024E;\u6102oduct;\u6210nterClockwiseContourIntegral;\u6233oss;\u6A2Fcr;\uC000\u{1D49E}p\u0100;C\u0284\u0285\u62D3ap;\u624D\u0580DJSZacefios\u02A0\u02AC\u02B0\u02B4\u02B8\u02CB\u02D7\u02E1\u02E6\u0333\u048D\u0100;o\u0179\u02A5trahd;\u6911cy;\u4402cy;\u4405cy;\u440F\u0180grs\u02BF\u02C4\u02C7ger;\u6021r;\u61A1hv;\u6AE4\u0100ay\u02D0\u02D5ron;\u410E;\u4414l\u0100;t\u02DD\u02DE\u6207a;\u4394r;\uC000\u{1D507}\u0100af\u02EB\u0327\u0100cm\u02F0\u0322ritical\u0200ADGT\u0300\u0306\u0316\u031Ccute;\u40B4o\u0174\u030B\u030D;\u42D9bleAcute;\u42DDrave;\u4060ilde;\u42DCond;\u62C4ferentialD;\u6146\u0470\u033D\0\0\0\u0342\u0354\0\u0405f;\uC000\u{1D53B}\u0180;DE\u0348\u0349\u034D\u40A8ot;\u60DCqual;\u6250ble\u0300CDLRUV\u0363\u0372\u0382\u03CF\u03E2\u03F8ontourIntegra\xEC\u0239o\u0274\u0379\0\0\u037B\xBB\u0349nArrow;\u61D3\u0100eo\u0387\u03A4ft\u0180ART\u0390\u0396\u03A1rrow;\u61D0ightArrow;\u61D4e\xE5\u02CAng\u0100LR\u03AB\u03C4eft\u0100AR\u03B3\u03B9rrow;\u67F8ightArrow;\u67FAightArrow;\u67F9ight\u0100AT\u03D8\u03DErrow;\u61D2ee;\u62A8p\u0241\u03E9\0\0\u03EFrrow;\u61D1ownArrow;\u61D5erticalBar;\u6225n\u0300ABLRTa\u0412\u042A\u0430\u045E\u047F\u037Crrow\u0180;BU\u041D\u041E\u0422\u6193ar;\u6913pArrow;\u61F5reve;\u4311eft\u02D2\u043A\0\u0446\0\u0450ightVector;\u6950eeVector;\u695Eector\u0100;B\u0459\u045A\u61BDar;\u6956ight\u01D4\u0467\0\u0471eeVector;\u695Fector\u0100;B\u047A\u047B\u61C1ar;\u6957ee\u0100;A\u0486\u0487\u62A4rrow;\u61A7\u0100ct\u0492\u0497r;\uC000\u{1D49F}rok;\u4110\u0800NTacdfglmopqstux\u04BD\u04C0\u04C4\u04CB\u04DE\u04E2\u04E7\u04EE\u04F5\u0521\u052F\u0536\u0552\u055D\u0560\u0565G;\u414AH\u803B\xD0\u40D0cute\u803B\xC9\u40C9\u0180aiy\u04D2\u04D7\u04DCron;\u411Arc\u803B\xCA\u40CA;\u442Dot;\u4116r;\uC000\u{1D508}rave\u803B\xC8\u40C8ement;\u6208\u0100ap\u04FA\u04FEcr;\u4112ty\u0253\u0506\0\0\u0512mallSquare;\u65FBerySmallSquare;\u65AB\u0100gp\u0526\u052Aon;\u4118f;\uC000\u{1D53C}silon;\u4395u\u0100ai\u053C\u0549l\u0100;T\u0542\u0543\u6A75ilde;\u6242librium;\u61CC\u0100ci\u0557\u055Ar;\u6130m;\u6A73a;\u4397ml\u803B\xCB\u40CB\u0100ip\u056A\u056Fsts;\u6203onentialE;\u6147\u0280cfios\u0585\u0588\u058D\u05B2\u05CCy;\u4424r;\uC000\u{1D509}lled\u0253\u0597\0\0\u05A3mallSquare;\u65FCerySmallSquare;\u65AA\u0370\u05BA\0\u05BF\0\0\u05C4f;\uC000\u{1D53D}All;\u6200riertrf;\u6131c\xF2\u05CB\u0600JTabcdfgorst\u05E8\u05EC\u05EF\u05FA\u0600\u0612\u0616\u061B\u061D\u0623\u066C\u0672cy;\u4403\u803B>\u403Emma\u0100;d\u05F7\u05F8\u4393;\u43DCreve;\u411E\u0180eiy\u0607\u060C\u0610dil;\u4122rc;\u411C;\u4413ot;\u4120r;\uC000\u{1D50A};\u62D9pf;\uC000\u{1D53E}eater\u0300EFGLST\u0635\u0644\u064E\u0656\u065B\u0666qual\u0100;L\u063E\u063F\u6265ess;\u62DBullEqual;\u6267reater;\u6AA2ess;\u6277lantEqual;\u6A7Eilde;\u6273cr;\uC000\u{1D4A2};\u626B\u0400Aacfiosu\u0685\u068B\u0696\u069B\u069E\u06AA\u06BE\u06CARDcy;\u442A\u0100ct\u0690\u0694ek;\u42C7;\u405Eirc;\u4124r;\u610ClbertSpace;\u610B\u01F0\u06AF\0\u06B2f;\u610DizontalLine;\u6500\u0100ct\u06C3\u06C5\xF2\u06A9rok;\u4126mp\u0144\u06D0\u06D8ownHum\xF0\u012Fqual;\u624F\u0700EJOacdfgmnostu\u06FA\u06FE\u0703\u0707\u070E\u071A\u071E\u0721\u0728\u0744\u0778\u078B\u078F\u0795cy;\u4415lig;\u4132cy;\u4401cute\u803B\xCD\u40CD\u0100iy\u0713\u0718rc\u803B\xCE\u40CE;\u4418ot;\u4130r;\u6111rave\u803B\xCC\u40CC\u0180;ap\u0720\u072F\u073F\u0100cg\u0734\u0737r;\u412AinaryI;\u6148lie\xF3\u03DD\u01F4\u0749\0\u0762\u0100;e\u074D\u074E\u622C\u0100gr\u0753\u0758ral;\u622Bsection;\u62C2isible\u0100CT\u076C\u0772omma;\u6063imes;\u6062\u0180gpt\u077F\u0783\u0788on;\u412Ef;\uC000\u{1D540}a;\u4399cr;\u6110ilde;\u4128\u01EB\u079A\0\u079Ecy;\u4406l\u803B\xCF\u40CF\u0280cfosu\u07AC\u07B7\u07BC\u07C2\u07D0\u0100iy\u07B1\u07B5rc;\u4134;\u4419r;\uC000\u{1D50D}pf;\uC000\u{1D541}\u01E3\u07C7\0\u07CCr;\uC000\u{1D4A5}rcy;\u4408kcy;\u4404\u0380HJacfos\u07E4\u07E8\u07EC\u07F1\u07FD\u0802\u0808cy;\u4425cy;\u440Cppa;\u439A\u0100ey\u07F6\u07FBdil;\u4136;\u441Ar;\uC000\u{1D50E}pf;\uC000\u{1D542}cr;\uC000\u{1D4A6}\u0580JTaceflmost\u0825\u0829\u082C\u0850\u0863\u09B3\u09B8\u09C7\u09CD\u0A37\u0A47cy;\u4409\u803B<\u403C\u0280cmnpr\u0837\u083C\u0841\u0844\u084Dute;\u4139bda;\u439Bg;\u67EAlacetrf;\u6112r;\u619E\u0180aey\u0857\u085C\u0861ron;\u413Ddil;\u413B;\u441B\u0100fs\u0868\u0970t\u0500ACDFRTUVar\u087E\u08A9\u08B1\u08E0\u08E6\u08FC\u092F\u095B\u0390\u096A\u0100nr\u0883\u088FgleBracket;\u67E8row\u0180;BR\u0899\u089A\u089E\u6190ar;\u61E4ightArrow;\u61C6eiling;\u6308o\u01F5\u08B7\0\u08C3bleBracket;\u67E6n\u01D4\u08C8\0\u08D2eeVector;\u6961ector\u0100;B\u08DB\u08DC\u61C3ar;\u6959loor;\u630Aight\u0100AV\u08EF\u08F5rrow;\u6194ector;\u694E\u0100er\u0901\u0917e\u0180;AV\u0909\u090A\u0910\u62A3rrow;\u61A4ector;\u695Aiangle\u0180;BE\u0924\u0925\u0929\u62B2ar;\u69CFqual;\u62B4p\u0180DTV\u0937\u0942\u094CownVector;\u6951eeVector;\u6960ector\u0100;B\u0956\u0957\u61BFar;\u6958ector\u0100;B\u0965\u0966\u61BCar;\u6952ight\xE1\u039Cs\u0300EFGLST\u097E\u098B\u0995\u099D\u09A2\u09ADqualGreater;\u62DAullEqual;\u6266reater;\u6276ess;\u6AA1lantEqual;\u6A7Dilde;\u6272r;\uC000\u{1D50F}\u0100;e\u09BD\u09BE\u62D8ftarrow;\u61DAidot;\u413F\u0180npw\u09D4\u0A16\u0A1Bg\u0200LRlr\u09DE\u09F7\u0A02\u0A10eft\u0100AR\u09E6\u09ECrrow;\u67F5ightArrow;\u67F7ightArrow;\u67F6eft\u0100ar\u03B3\u0A0Aight\xE1\u03BFight\xE1\u03CAf;\uC000\u{1D543}er\u0100LR\u0A22\u0A2CeftArrow;\u6199ightArrow;\u6198\u0180cht\u0A3E\u0A40\u0A42\xF2\u084C;\u61B0rok;\u4141;\u626A\u0400acefiosu\u0A5A\u0A5D\u0A60\u0A77\u0A7C\u0A85\u0A8B\u0A8Ep;\u6905y;\u441C\u0100dl\u0A65\u0A6FiumSpace;\u605Flintrf;\u6133r;\uC000\u{1D510}nusPlus;\u6213pf;\uC000\u{1D544}c\xF2\u0A76;\u439C\u0480Jacefostu\u0AA3\u0AA7\u0AAD\u0AC0\u0B14\u0B19\u0D91\u0D97\u0D9Ecy;\u440Acute;\u4143\u0180aey\u0AB4\u0AB9\u0ABEron;\u4147dil;\u4145;\u441D\u0180gsw\u0AC7\u0AF0\u0B0Eative\u0180MTV\u0AD3\u0ADF\u0AE8ediumSpace;\u600Bhi\u0100cn\u0AE6\u0AD8\xEB\u0AD9eryThi\xEE\u0AD9ted\u0100GL\u0AF8\u0B06reaterGreate\xF2\u0673essLes\xF3\u0A48Line;\u400Ar;\uC000\u{1D511}\u0200Bnpt\u0B22\u0B28\u0B37\u0B3Areak;\u6060BreakingSpace;\u40A0f;\u6115\u0680;CDEGHLNPRSTV\u0B55\u0B56\u0B6A\u0B7C\u0BA1\u0BEB\u0C04\u0C5E\u0C84\u0CA6\u0CD8\u0D61\u0D85\u6AEC\u0100ou\u0B5B\u0B64ngruent;\u6262pCap;\u626DoubleVerticalBar;\u6226\u0180lqx\u0B83\u0B8A\u0B9Bement;\u6209ual\u0100;T\u0B92\u0B93\u6260ilde;\uC000\u2242\u0338ists;\u6204reater\u0380;EFGLST\u0BB6\u0BB7\u0BBD\u0BC9\u0BD3\u0BD8\u0BE5\u626Fqual;\u6271ullEqual;\uC000\u2267\u0338reater;\uC000\u226B\u0338ess;\u6279lantEqual;\uC000\u2A7E\u0338ilde;\u6275ump\u0144\u0BF2\u0BFDownHump;\uC000\u224E\u0338qual;\uC000\u224F\u0338e\u0100fs\u0C0A\u0C27tTriangle\u0180;BE\u0C1A\u0C1B\u0C21\u62EAar;\uC000\u29CF\u0338qual;\u62ECs\u0300;EGLST\u0C35\u0C36\u0C3C\u0C44\u0C4B\u0C58\u626Equal;\u6270reater;\u6278ess;\uC000\u226A\u0338lantEqual;\uC000\u2A7D\u0338ilde;\u6274ested\u0100GL\u0C68\u0C79reaterGreater;\uC000\u2AA2\u0338essLess;\uC000\u2AA1\u0338recedes\u0180;ES\u0C92\u0C93\u0C9B\u6280qual;\uC000\u2AAF\u0338lantEqual;\u62E0\u0100ei\u0CAB\u0CB9verseElement;\u620CghtTriangle\u0180;BE\u0CCB\u0CCC\u0CD2\u62EBar;\uC000\u29D0\u0338qual;\u62ED\u0100qu\u0CDD\u0D0CuareSu\u0100bp\u0CE8\u0CF9set\u0100;E\u0CF0\u0CF3\uC000\u228F\u0338qual;\u62E2erset\u0100;E\u0D03\u0D06\uC000\u2290\u0338qual;\u62E3\u0180bcp\u0D13\u0D24\u0D4Eset\u0100;E\u0D1B\u0D1E\uC000\u2282\u20D2qual;\u6288ceeds\u0200;EST\u0D32\u0D33\u0D3B\u0D46\u6281qual;\uC000\u2AB0\u0338lantEqual;\u62E1ilde;\uC000\u227F\u0338erset\u0100;E\u0D58\u0D5B\uC000\u2283\u20D2qual;\u6289ilde\u0200;EFT\u0D6E\u0D6F\u0D75\u0D7F\u6241qual;\u6244ullEqual;\u6247ilde;\u6249erticalBar;\u6224cr;\uC000\u{1D4A9}ilde\u803B\xD1\u40D1;\u439D\u0700Eacdfgmoprstuv\u0DBD\u0DC2\u0DC9\u0DD5\u0DDB\u0DE0\u0DE7\u0DFC\u0E02\u0E20\u0E22\u0E32\u0E3F\u0E44lig;\u4152cute\u803B\xD3\u40D3\u0100iy\u0DCE\u0DD3rc\u803B\xD4\u40D4;\u441Eblac;\u4150r;\uC000\u{1D512}rave\u803B\xD2\u40D2\u0180aei\u0DEE\u0DF2\u0DF6cr;\u414Cga;\u43A9cron;\u439Fpf;\uC000\u{1D546}enCurly\u0100DQ\u0E0E\u0E1AoubleQuote;\u601Cuote;\u6018;\u6A54\u0100cl\u0E27\u0E2Cr;\uC000\u{1D4AA}ash\u803B\xD8\u40D8i\u016C\u0E37\u0E3Cde\u803B\xD5\u40D5es;\u6A37ml\u803B\xD6\u40D6er\u0100BP\u0E4B\u0E60\u0100ar\u0E50\u0E53r;\u603Eac\u0100ek\u0E5A\u0E5C;\u63DEet;\u63B4arenthesis;\u63DC\u0480acfhilors\u0E7F\u0E87\u0E8A\u0E8F\u0E92\u0E94\u0E9D\u0EB0\u0EFCrtialD;\u6202y;\u441Fr;\uC000\u{1D513}i;\u43A6;\u43A0usMinus;\u40B1\u0100ip\u0EA2\u0EADncareplan\xE5\u069Df;\u6119\u0200;eio\u0EB9\u0EBA\u0EE0\u0EE4\u6ABBcedes\u0200;EST\u0EC8\u0EC9\u0ECF\u0EDA\u627Aqual;\u6AAFlantEqual;\u627Cilde;\u627Eme;\u6033\u0100dp\u0EE9\u0EEEuct;\u620Fortion\u0100;a\u0225\u0EF9l;\u621D\u0100ci\u0F01\u0F06r;\uC000\u{1D4AB};\u43A8\u0200Ufos\u0F11\u0F16\u0F1B\u0F1FOT\u803B"\u4022r;\uC000\u{1D514}pf;\u611Acr;\uC000\u{1D4AC}\u0600BEacefhiorsu\u0F3E\u0F43\u0F47\u0F60\u0F73\u0FA7\u0FAA\u0FAD\u1096\u10A9\u10B4\u10BEarr;\u6910G\u803B\xAE\u40AE\u0180cnr\u0F4E\u0F53\u0F56ute;\u4154g;\u67EBr\u0100;t\u0F5C\u0F5D\u61A0l;\u6916\u0180aey\u0F67\u0F6C\u0F71ron;\u4158dil;\u4156;\u4420\u0100;v\u0F78\u0F79\u611Cerse\u0100EU\u0F82\u0F99\u0100lq\u0F87\u0F8Eement;\u620Builibrium;\u61CBpEquilibrium;\u696Fr\xBB\u0F79o;\u43A1ght\u0400ACDFTUVa\u0FC1\u0FEB\u0FF3\u1022\u1028\u105B\u1087\u03D8\u0100nr\u0FC6\u0FD2gleBracket;\u67E9row\u0180;BL\u0FDC\u0FDD\u0FE1\u6192ar;\u61E5eftArrow;\u61C4eiling;\u6309o\u01F5\u0FF9\0\u1005bleBracket;\u67E7n\u01D4\u100A\0\u1014eeVector;\u695Dector\u0100;B\u101D\u101E\u61C2ar;\u6955loor;\u630B\u0100er\u102D\u1043e\u0180;AV\u1035\u1036\u103C\u62A2rrow;\u61A6ector;\u695Biangle\u0180;BE\u1050\u1051\u1055\u62B3ar;\u69D0qual;\u62B5p\u0180DTV\u1063\u106E\u1078ownVector;\u694FeeVector;\u695Cector\u0100;B\u1082\u1083\u61BEar;\u6954ector\u0100;B\u1091\u1092\u61C0ar;\u6953\u0100pu\u109B\u109Ef;\u611DndImplies;\u6970ightarrow;\u61DB\u0100ch\u10B9\u10BCr;\u611B;\u61B1leDelayed;\u69F4\u0680HOacfhimoqstu\u10E4\u10F1\u10F7\u10FD\u1119\u111E\u1151\u1156\u1161\u1167\u11B5\u11BB\u11BF\u0100Cc\u10E9\u10EEHcy;\u4429y;\u4428FTcy;\u442Ccute;\u415A\u0280;aeiy\u1108\u1109\u110E\u1113\u1117\u6ABCron;\u4160dil;\u415Erc;\u415C;\u4421r;\uC000\u{1D516}ort\u0200DLRU\u112A\u1134\u113E\u1149ownArrow\xBB\u041EeftArrow\xBB\u089AightArrow\xBB\u0FDDpArrow;\u6191gma;\u43A3allCircle;\u6218pf;\uC000\u{1D54A}\u0272\u116D\0\0\u1170t;\u621Aare\u0200;ISU\u117B\u117C\u1189\u11AF\u65A1ntersection;\u6293u\u0100bp\u118F\u119Eset\u0100;E\u1197\u1198\u628Fqual;\u6291erset\u0100;E\u11A8\u11A9\u6290qual;\u6292nion;\u6294cr;\uC000\u{1D4AE}ar;\u62C6\u0200bcmp\u11C8\u11DB\u1209\u120B\u0100;s\u11CD\u11CE\u62D0et\u0100;E\u11CD\u11D5qual;\u6286\u0100ch\u11E0\u1205eeds\u0200;EST\u11ED\u11EE\u11F4\u11FF\u627Bqual;\u6AB0lantEqual;\u627Dilde;\u627FTh\xE1\u0F8C;\u6211\u0180;es\u1212\u1213\u1223\u62D1rset\u0100;E\u121C\u121D\u6283qual;\u6287et\xBB\u1213\u0580HRSacfhiors\u123E\u1244\u1249\u1255\u125E\u1271\u1276\u129F\u12C2\u12C8\u12D1ORN\u803B\xDE\u40DEADE;\u6122\u0100Hc\u124E\u1252cy;\u440By;\u4426\u0100bu\u125A\u125C;\u4009;\u43A4\u0180aey\u1265\u126A\u126Fron;\u4164dil;\u4162;\u4422r;\uC000\u{1D517}\u0100ei\u127B\u1289\u01F2\u1280\0\u1287efore;\u6234a;\u4398\u0100cn\u128E\u1298kSpace;\uC000\u205F\u200ASpace;\u6009lde\u0200;EFT\u12AB\u12AC\u12B2\u12BC\u623Cqual;\u6243ullEqual;\u6245ilde;\u6248pf;\uC000\u{1D54B}ipleDot;\u60DB\u0100ct\u12D6\u12DBr;\uC000\u{1D4AF}rok;\u4166\u0AE1\u12F7\u130E\u131A\u1326\0\u132C\u1331\0\0\0\0\0\u1338\u133D\u1377\u1385\0\u13FF\u1404\u140A\u1410\u0100cr\u12FB\u1301ute\u803B\xDA\u40DAr\u0100;o\u1307\u1308\u619Fcir;\u6949r\u01E3\u1313\0\u1316y;\u440Eve;\u416C\u0100iy\u131E\u1323rc\u803B\xDB\u40DB;\u4423blac;\u4170r;\uC000\u{1D518}rave\u803B\xD9\u40D9acr;\u416A\u0100di\u1341\u1369er\u0100BP\u1348\u135D\u0100ar\u134D\u1350r;\u405Fac\u0100ek\u1357\u1359;\u63DFet;\u63B5arenthesis;\u63DDon\u0100;P\u1370\u1371\u62C3lus;\u628E\u0100gp\u137B\u137Fon;\u4172f;\uC000\u{1D54C}\u0400ADETadps\u1395\u13AE\u13B8\u13C4\u03E8\u13D2\u13D7\u13F3rrow\u0180;BD\u1150\u13A0\u13A4ar;\u6912ownArrow;\u61C5ownArrow;\u6195quilibrium;\u696Eee\u0100;A\u13CB\u13CC\u62A5rrow;\u61A5own\xE1\u03F3er\u0100LR\u13DE\u13E8eftArrow;\u6196ightArrow;\u6197i\u0100;l\u13F9\u13FA\u43D2on;\u43A5ing;\u416Ecr;\uC000\u{1D4B0}ilde;\u4168ml\u803B\xDC\u40DC\u0480Dbcdefosv\u1427\u142C\u1430\u1433\u143E\u1485\u148A\u1490\u1496ash;\u62ABar;\u6AEBy;\u4412ash\u0100;l\u143B\u143C\u62A9;\u6AE6\u0100er\u1443\u1445;\u62C1\u0180bty\u144C\u1450\u147Aar;\u6016\u0100;i\u144F\u1455cal\u0200BLST\u1461\u1465\u146A\u1474ar;\u6223ine;\u407Ceparator;\u6758ilde;\u6240ThinSpace;\u600Ar;\uC000\u{1D519}pf;\uC000\u{1D54D}cr;\uC000\u{1D4B1}dash;\u62AA\u0280cefos\u14A7\u14AC\u14B1\u14B6\u14BCirc;\u4174dge;\u62C0r;\uC000\u{1D51A}pf;\uC000\u{1D54E}cr;\uC000\u{1D4B2}\u0200fios\u14CB\u14D0\u14D2\u14D8r;\uC000\u{1D51B};\u439Epf;\uC000\u{1D54F}cr;\uC000\u{1D4B3}\u0480AIUacfosu\u14F1\u14F5\u14F9\u14FD\u1504\u150F\u1514\u151A\u1520cy;\u442Fcy;\u4407cy;\u442Ecute\u803B\xDD\u40DD\u0100iy\u1509\u150Drc;\u4176;\u442Br;\uC000\u{1D51C}pf;\uC000\u{1D550}cr;\uC000\u{1D4B4}ml;\u4178\u0400Hacdefos\u1535\u1539\u153F\u154B\u154F\u155D\u1560\u1564cy;\u4416cute;\u4179\u0100ay\u1544\u1549ron;\u417D;\u4417ot;\u417B\u01F2\u1554\0\u155BoWidt\xE8\u0AD9a;\u4396r;\u6128pf;\u6124cr;\uC000\u{1D4B5}\u0BE1\u1583\u158A\u1590\0\u15B0\u15B6\u15BF\0\0\0\0\u15C6\u15DB\u15EB\u165F\u166D\0\u1695\u169B\u16B2\u16B9\0\u16BEcute\u803B\xE1\u40E1reve;\u4103\u0300;Ediuy\u159C\u159D\u15A1\u15A3\u15A8\u15AD\u623E;\uC000\u223E\u0333;\u623Frc\u803B\xE2\u40E2te\u80BB\xB4\u0306;\u4430lig\u803B\xE6\u40E6\u0100;r\xB2\u15BA;\uC000\u{1D51E}rave\u803B\xE0\u40E0\u0100ep\u15CA\u15D6\u0100fp\u15CF\u15D4sym;\u6135\xE8\u15D3ha;\u43B1\u0100ap\u15DFc\u0100cl\u15E4\u15E7r;\u4101g;\u6A3F\u0264\u15F0\0\0\u160A\u0280;adsv\u15FA\u15FB\u15FF\u1601\u1607\u6227nd;\u6A55;\u6A5Clope;\u6A58;\u6A5A\u0380;elmrsz\u1618\u1619\u161B\u161E\u163F\u164F\u1659\u6220;\u69A4e\xBB\u1619sd\u0100;a\u1625\u1626\u6221\u0461\u1630\u1632\u1634\u1636\u1638\u163A\u163C\u163E;\u69A8;\u69A9;\u69AA;\u69AB;\u69AC;\u69AD;\u69AE;\u69AFt\u0100;v\u1645\u1646\u621Fb\u0100;d\u164C\u164D\u62BE;\u699D\u0100pt\u1654\u1657h;\u6222\xBB\xB9arr;\u637C\u0100gp\u1663\u1667on;\u4105f;\uC000\u{1D552}\u0380;Eaeiop\u12C1\u167B\u167D\u1682\u1684\u1687\u168A;\u6A70cir;\u6A6F;\u624Ad;\u624Bs;\u4027rox\u0100;e\u12C1\u1692\xF1\u1683ing\u803B\xE5\u40E5\u0180cty\u16A1\u16A6\u16A8r;\uC000\u{1D4B6};\u402Amp\u0100;e\u12C1\u16AF\xF1\u0288ilde\u803B\xE3\u40E3ml\u803B\xE4\u40E4\u0100ci\u16C2\u16C8onin\xF4\u0272nt;\u6A11\u0800Nabcdefiklnoprsu\u16ED\u16F1\u1730\u173C\u1743\u1748\u1778\u177D\u17E0\u17E6\u1839\u1850\u170D\u193D\u1948\u1970ot;\u6AED\u0100cr\u16F6\u171Ek\u0200ceps\u1700\u1705\u170D\u1713ong;\u624Cpsilon;\u43F6rime;\u6035im\u0100;e\u171A\u171B\u623Dq;\u62CD\u0176\u1722\u1726ee;\u62BDed\u0100;g\u172C\u172D\u6305e\xBB\u172Drk\u0100;t\u135C\u1737brk;\u63B6\u0100oy\u1701\u1741;\u4431quo;\u601E\u0280cmprt\u1753\u175B\u1761\u1764\u1768aus\u0100;e\u010A\u0109ptyv;\u69B0s\xE9\u170Cno\xF5\u0113\u0180ahw\u176F\u1771\u1773;\u43B2;\u6136een;\u626Cr;\uC000\u{1D51F}g\u0380costuvw\u178D\u179D\u17B3\u17C1\u17D5\u17DB\u17DE\u0180aiu\u1794\u1796\u179A\xF0\u0760rc;\u65EFp\xBB\u1371\u0180dpt\u17A4\u17A8\u17ADot;\u6A00lus;\u6A01imes;\u6A02\u0271\u17B9\0\0\u17BEcup;\u6A06ar;\u6605riangle\u0100du\u17CD\u17D2own;\u65BDp;\u65B3plus;\u6A04e\xE5\u1444\xE5\u14ADarow;\u690D\u0180ako\u17ED\u1826\u1835\u0100cn\u17F2\u1823k\u0180lst\u17FA\u05AB\u1802ozenge;\u69EBriangle\u0200;dlr\u1812\u1813\u1818\u181D\u65B4own;\u65BEeft;\u65C2ight;\u65B8k;\u6423\u01B1\u182B\0\u1833\u01B2\u182F\0\u1831;\u6592;\u65914;\u6593ck;\u6588\u0100eo\u183E\u184D\u0100;q\u1843\u1846\uC000=\u20E5uiv;\uC000\u2261\u20E5t;\u6310\u0200ptwx\u1859\u185E\u1867\u186Cf;\uC000\u{1D553}\u0100;t\u13CB\u1863om\xBB\u13CCtie;\u62C8\u0600DHUVbdhmptuv\u1885\u1896\u18AA\u18BB\u18D7\u18DB\u18EC\u18FF\u1905\u190A\u1910\u1921\u0200LRlr\u188E\u1890\u1892\u1894;\u6557;\u6554;\u6556;\u6553\u0280;DUdu\u18A1\u18A2\u18A4\u18A6\u18A8\u6550;\u6566;\u6569;\u6564;\u6567\u0200LRlr\u18B3\u18B5\u18B7\u18B9;\u655D;\u655A;\u655C;\u6559\u0380;HLRhlr\u18CA\u18CB\u18CD\u18CF\u18D1\u18D3\u18D5\u6551;\u656C;\u6563;\u6560;\u656B;\u6562;\u655Fox;\u69C9\u0200LRlr\u18E4\u18E6\u18E8\u18EA;\u6555;\u6552;\u6510;\u650C\u0280;DUdu\u06BD\u18F7\u18F9\u18FB\u18FD;\u6565;\u6568;\u652C;\u6534inus;\u629Flus;\u629Eimes;\u62A0\u0200LRlr\u1919\u191B\u191D\u191F;\u655B;\u6558;\u6518;\u6514\u0380;HLRhlr\u1930\u1931\u1933\u1935\u1937\u1939\u193B\u6502;\u656A;\u6561;\u655E;\u653C;\u6524;\u651C\u0100ev\u0123\u1942bar\u803B\xA6\u40A6\u0200ceio\u1951\u1956\u195A\u1960r;\uC000\u{1D4B7}mi;\u604Fm\u0100;e\u171A\u171Cl\u0180;bh\u1968\u1969\u196B\u405C;\u69C5sub;\u67C8\u016C\u1974\u197El\u0100;e\u1979\u197A\u6022t\xBB\u197Ap\u0180;Ee\u012F\u1985\u1987;\u6AAE\u0100;q\u06DC\u06DB\u0CE1\u19A7\0\u19E8\u1A11\u1A15\u1A32\0\u1A37\u1A50\0\0\u1AB4\0\0\u1AC1\0\0\u1B21\u1B2E\u1B4D\u1B52\0\u1BFD\0\u1C0C\u0180cpr\u19AD\u19B2\u19DDute;\u4107\u0300;abcds\u19BF\u19C0\u19C4\u19CA\u19D5\u19D9\u6229nd;\u6A44rcup;\u6A49\u0100au\u19CF\u19D2p;\u6A4Bp;\u6A47ot;\u6A40;\uC000\u2229\uFE00\u0100eo\u19E2\u19E5t;\u6041\xEE\u0693\u0200aeiu\u19F0\u19FB\u1A01\u1A05\u01F0\u19F5\0\u19F8s;\u6A4Don;\u410Ddil\u803B\xE7\u40E7rc;\u4109ps\u0100;s\u1A0C\u1A0D\u6A4Cm;\u6A50ot;\u410B\u0180dmn\u1A1B\u1A20\u1A26il\u80BB\xB8\u01ADptyv;\u69B2t\u8100\xA2;e\u1A2D\u1A2E\u40A2r\xE4\u01B2r;\uC000\u{1D520}\u0180cei\u1A3D\u1A40\u1A4Dy;\u4447ck\u0100;m\u1A47\u1A48\u6713ark\xBB\u1A48;\u43C7r\u0380;Ecefms\u1A5F\u1A60\u1A62\u1A6B\u1AA4\u1AAA\u1AAE\u65CB;\u69C3\u0180;el\u1A69\u1A6A\u1A6D\u42C6q;\u6257e\u0261\u1A74\0\0\u1A88rrow\u0100lr\u1A7C\u1A81eft;\u61BAight;\u61BB\u0280RSacd\u1A92\u1A94\u1A96\u1A9A\u1A9F\xBB\u0F47;\u64C8st;\u629Birc;\u629Aash;\u629Dnint;\u6A10id;\u6AEFcir;\u69C2ubs\u0100;u\u1ABB\u1ABC\u6663it\xBB\u1ABC\u02EC\u1AC7\u1AD4\u1AFA\0\u1B0Aon\u0100;e\u1ACD\u1ACE\u403A\u0100;q\xC7\xC6\u026D\u1AD9\0\0\u1AE2a\u0100;t\u1ADE\u1ADF\u402C;\u4040\u0180;fl\u1AE8\u1AE9\u1AEB\u6201\xEE\u1160e\u0100mx\u1AF1\u1AF6ent\xBB\u1AE9e\xF3\u024D\u01E7\u1AFE\0\u1B07\u0100;d\u12BB\u1B02ot;\u6A6Dn\xF4\u0246\u0180fry\u1B10\u1B14\u1B17;\uC000\u{1D554}o\xE4\u0254\u8100\xA9;s\u0155\u1B1Dr;\u6117\u0100ao\u1B25\u1B29rr;\u61B5ss;\u6717\u0100cu\u1B32\u1B37r;\uC000\u{1D4B8}\u0100bp\u1B3C\u1B44\u0100;e\u1B41\u1B42\u6ACF;\u6AD1\u0100;e\u1B49\u1B4A\u6AD0;\u6AD2dot;\u62EF\u0380delprvw\u1B60\u1B6C\u1B77\u1B82\u1BAC\u1BD4\u1BF9arr\u0100lr\u1B68\u1B6A;\u6938;\u6935\u0270\u1B72\0\0\u1B75r;\u62DEc;\u62DFarr\u0100;p\u1B7F\u1B80\u61B6;\u693D\u0300;bcdos\u1B8F\u1B90\u1B96\u1BA1\u1BA5\u1BA8\u622Arcap;\u6A48\u0100au\u1B9B\u1B9Ep;\u6A46p;\u6A4Aot;\u628Dr;\u6A45;\uC000\u222A\uFE00\u0200alrv\u1BB5\u1BBF\u1BDE\u1BE3rr\u0100;m\u1BBC\u1BBD\u61B7;\u693Cy\u0180evw\u1BC7\u1BD4\u1BD8q\u0270\u1BCE\0\0\u1BD2re\xE3\u1B73u\xE3\u1B75ee;\u62CEedge;\u62CFen\u803B\xA4\u40A4earrow\u0100lr\u1BEE\u1BF3eft\xBB\u1B80ight\xBB\u1BBDe\xE4\u1BDD\u0100ci\u1C01\u1C07onin\xF4\u01F7nt;\u6231lcty;\u632D\u0980AHabcdefhijlorstuwz\u1C38\u1C3B\u1C3F\u1C5D\u1C69\u1C75\u1C8A\u1C9E\u1CAC\u1CB7\u1CFB\u1CFF\u1D0D\u1D7B\u1D91\u1DAB\u1DBB\u1DC6\u1DCDr\xF2\u0381ar;\u6965\u0200glrs\u1C48\u1C4D\u1C52\u1C54ger;\u6020eth;\u6138\xF2\u1133h\u0100;v\u1C5A\u1C5B\u6010\xBB\u090A\u016B\u1C61\u1C67arow;\u690Fa\xE3\u0315\u0100ay\u1C6E\u1C73ron;\u410F;\u4434\u0180;ao\u0332\u1C7C\u1C84\u0100gr\u02BF\u1C81r;\u61CAtseq;\u6A77\u0180glm\u1C91\u1C94\u1C98\u803B\xB0\u40B0ta;\u43B4ptyv;\u69B1\u0100ir\u1CA3\u1CA8sht;\u697F;\uC000\u{1D521}ar\u0100lr\u1CB3\u1CB5\xBB\u08DC\xBB\u101E\u0280aegsv\u1CC2\u0378\u1CD6\u1CDC\u1CE0m\u0180;os\u0326\u1CCA\u1CD4nd\u0100;s\u0326\u1CD1uit;\u6666amma;\u43DDin;\u62F2\u0180;io\u1CE7\u1CE8\u1CF8\u40F7de\u8100\xF7;o\u1CE7\u1CF0ntimes;\u62C7n\xF8\u1CF7cy;\u4452c\u026F\u1D06\0\0\u1D0Arn;\u631Eop;\u630D\u0280lptuw\u1D18\u1D1D\u1D22\u1D49\u1D55lar;\u4024f;\uC000\u{1D555}\u0280;emps\u030B\u1D2D\u1D37\u1D3D\u1D42q\u0100;d\u0352\u1D33ot;\u6251inus;\u6238lus;\u6214quare;\u62A1blebarwedg\xE5\xFAn\u0180adh\u112E\u1D5D\u1D67ownarrow\xF3\u1C83arpoon\u0100lr\u1D72\u1D76ef\xF4\u1CB4igh\xF4\u1CB6\u0162\u1D7F\u1D85karo\xF7\u0F42\u026F\u1D8A\0\0\u1D8Ern;\u631Fop;\u630C\u0180cot\u1D98\u1DA3\u1DA6\u0100ry\u1D9D\u1DA1;\uC000\u{1D4B9};\u4455l;\u69F6rok;\u4111\u0100dr\u1DB0\u1DB4ot;\u62F1i\u0100;f\u1DBA\u1816\u65BF\u0100ah\u1DC0\u1DC3r\xF2\u0429a\xF2\u0FA6angle;\u69A6\u0100ci\u1DD2\u1DD5y;\u445Fgrarr;\u67FF\u0900Dacdefglmnopqrstux\u1E01\u1E09\u1E19\u1E38\u0578\u1E3C\u1E49\u1E61\u1E7E\u1EA5\u1EAF\u1EBD\u1EE1\u1F2A\u1F37\u1F44\u1F4E\u1F5A\u0100Do\u1E06\u1D34o\xF4\u1C89\u0100cs\u1E0E\u1E14ute\u803B\xE9\u40E9ter;\u6A6E\u0200aioy\u1E22\u1E27\u1E31\u1E36ron;\u411Br\u0100;c\u1E2D\u1E2E\u6256\u803B\xEA\u40EAlon;\u6255;\u444Dot;\u4117\u0100Dr\u1E41\u1E45ot;\u6252;\uC000\u{1D522}\u0180;rs\u1E50\u1E51\u1E57\u6A9Aave\u803B\xE8\u40E8\u0100;d\u1E5C\u1E5D\u6A96ot;\u6A98\u0200;ils\u1E6A\u1E6B\u1E72\u1E74\u6A99nters;\u63E7;\u6113\u0100;d\u1E79\u1E7A\u6A95ot;\u6A97\u0180aps\u1E85\u1E89\u1E97cr;\u4113ty\u0180;sv\u1E92\u1E93\u1E95\u6205et\xBB\u1E93p\u01001;\u1E9D\u1EA4\u0133\u1EA1\u1EA3;\u6004;\u6005\u6003\u0100gs\u1EAA\u1EAC;\u414Bp;\u6002\u0100gp\u1EB4\u1EB8on;\u4119f;\uC000\u{1D556}\u0180als\u1EC4\u1ECE\u1ED2r\u0100;s\u1ECA\u1ECB\u62D5l;\u69E3us;\u6A71i\u0180;lv\u1EDA\u1EDB\u1EDF\u43B5on\xBB\u1EDB;\u43F5\u0200csuv\u1EEA\u1EF3\u1F0B\u1F23\u0100io\u1EEF\u1E31rc\xBB\u1E2E\u0269\u1EF9\0\0\u1EFB\xED\u0548ant\u0100gl\u1F02\u1F06tr\xBB\u1E5Dess\xBB\u1E7A\u0180aei\u1F12\u1F16\u1F1Als;\u403Dst;\u625Fv\u0100;D\u0235\u1F20D;\u6A78parsl;\u69E5\u0100Da\u1F2F\u1F33ot;\u6253rr;\u6971\u0180cdi\u1F3E\u1F41\u1EF8r;\u612Fo\xF4\u0352\u0100ah\u1F49\u1F4B;\u43B7\u803B\xF0\u40F0\u0100mr\u1F53\u1F57l\u803B\xEB\u40EBo;\u60AC\u0180cip\u1F61\u1F64\u1F67l;\u4021s\xF4\u056E\u0100eo\u1F6C\u1F74ctatio\xEE\u0559nential\xE5\u0579\u09E1\u1F92\0\u1F9E\0\u1FA1\u1FA7\0\0\u1FC6\u1FCC\0\u1FD3\0\u1FE6\u1FEA\u2000\0\u2008\u205Allingdotse\xF1\u1E44y;\u4444male;\u6640\u0180ilr\u1FAD\u1FB3\u1FC1lig;\u8000\uFB03\u0269\u1FB9\0\0\u1FBDg;\u8000\uFB00ig;\u8000\uFB04;\uC000\u{1D523}lig;\u8000\uFB01lig;\uC000fj\u0180alt\u1FD9\u1FDC\u1FE1t;\u666Dig;\u8000\uFB02ns;\u65B1of;\u4192\u01F0\u1FEE\0\u1FF3f;\uC000\u{1D557}\u0100ak\u05BF\u1FF7\u0100;v\u1FFC\u1FFD\u62D4;\u6AD9artint;\u6A0D\u0100ao\u200C\u2055\u0100cs\u2011\u2052\u03B1\u201A\u2030\u2038\u2045\u2048\0\u2050\u03B2\u2022\u2025\u2027\u202A\u202C\0\u202E\u803B\xBD\u40BD;\u6153\u803B\xBC\u40BC;\u6155;\u6159;\u615B\u01B3\u2034\0\u2036;\u6154;\u6156\u02B4\u203E\u2041\0\0\u2043\u803B\xBE\u40BE;\u6157;\u615C5;\u6158\u01B6\u204C\0\u204E;\u615A;\u615D8;\u615El;\u6044wn;\u6322cr;\uC000\u{1D4BB}\u0880Eabcdefgijlnorstv\u2082\u2089\u209F\u20A5\u20B0\u20B4\u20F0\u20F5\u20FA\u20FF\u2103\u2112\u2138\u0317\u213E\u2152\u219E\u0100;l\u064D\u2087;\u6A8C\u0180cmp\u2090\u2095\u209Dute;\u41F5ma\u0100;d\u209C\u1CDA\u43B3;\u6A86reve;\u411F\u0100iy\u20AA\u20AErc;\u411D;\u4433ot;\u4121\u0200;lqs\u063E\u0642\u20BD\u20C9\u0180;qs\u063E\u064C\u20C4lan\xF4\u0665\u0200;cdl\u0665\u20D2\u20D5\u20E5c;\u6AA9ot\u0100;o\u20DC\u20DD\u6A80\u0100;l\u20E2\u20E3\u6A82;\u6A84\u0100;e\u20EA\u20ED\uC000\u22DB\uFE00s;\u6A94r;\uC000\u{1D524}\u0100;g\u0673\u061Bmel;\u6137cy;\u4453\u0200;Eaj\u065A\u210C\u210E\u2110;\u6A92;\u6AA5;\u6AA4\u0200Eaes\u211B\u211D\u2129\u2134;\u6269p\u0100;p\u2123\u2124\u6A8Arox\xBB\u2124\u0100;q\u212E\u212F\u6A88\u0100;q\u212E\u211Bim;\u62E7pf;\uC000\u{1D558}\u0100ci\u2143\u2146r;\u610Am\u0180;el\u066B\u214E\u2150;\u6A8E;\u6A90\u8300>;cdlqr\u05EE\u2160\u216A\u216E\u2173\u2179\u0100ci\u2165\u2167;\u6AA7r;\u6A7Aot;\u62D7Par;\u6995uest;\u6A7C\u0280adels\u2184\u216A\u2190\u0656\u219B\u01F0\u2189\0\u218Epro\xF8\u209Er;\u6978q\u0100lq\u063F\u2196les\xF3\u2088i\xED\u066B\u0100en\u21A3\u21ADrtneqq;\uC000\u2269\uFE00\xC5\u21AA\u0500Aabcefkosy\u21C4\u21C7\u21F1\u21F5\u21FA\u2218\u221D\u222F\u2268\u227Dr\xF2\u03A0\u0200ilmr\u21D0\u21D4\u21D7\u21DBrs\xF0\u1484f\xBB\u2024il\xF4\u06A9\u0100dr\u21E0\u21E4cy;\u444A\u0180;cw\u08F4\u21EB\u21EFir;\u6948;\u61ADar;\u610Firc;\u4125\u0180alr\u2201\u220E\u2213rts\u0100;u\u2209\u220A\u6665it\xBB\u220Alip;\u6026con;\u62B9r;\uC000\u{1D525}s\u0100ew\u2223\u2229arow;\u6925arow;\u6926\u0280amopr\u223A\u223E\u2243\u225E\u2263rr;\u61FFtht;\u623Bk\u0100lr\u2249\u2253eftarrow;\u61A9ightarrow;\u61AAf;\uC000\u{1D559}bar;\u6015\u0180clt\u226F\u2274\u2278r;\uC000\u{1D4BD}as\xE8\u21F4rok;\u4127\u0100bp\u2282\u2287ull;\u6043hen\xBB\u1C5B\u0AE1\u22A3\0\u22AA\0\u22B8\u22C5\u22CE\0\u22D5\u22F3\0\0\u22F8\u2322\u2367\u2362\u237F\0\u2386\u23AA\u23B4cute\u803B\xED\u40ED\u0180;iy\u0771\u22B0\u22B5rc\u803B\xEE\u40EE;\u4438\u0100cx\u22BC\u22BFy;\u4435cl\u803B\xA1\u40A1\u0100fr\u039F\u22C9;\uC000\u{1D526}rave\u803B\xEC\u40EC\u0200;ino\u073E\u22DD\u22E9\u22EE\u0100in\u22E2\u22E6nt;\u6A0Ct;\u622Dfin;\u69DCta;\u6129lig;\u4133\u0180aop\u22FE\u231A\u231D\u0180cgt\u2305\u2308\u2317r;\u412B\u0180elp\u071F\u230F\u2313in\xE5\u078Ear\xF4\u0720h;\u4131f;\u62B7ed;\u41B5\u0280;cfot\u04F4\u232C\u2331\u233D\u2341are;\u6105in\u0100;t\u2338\u2339\u621Eie;\u69DDdo\xF4\u2319\u0280;celp\u0757\u234C\u2350\u235B\u2361al;\u62BA\u0100gr\u2355\u2359er\xF3\u1563\xE3\u234Darhk;\u6A17rod;\u6A3C\u0200cgpt\u236F\u2372\u2376\u237By;\u4451on;\u412Ff;\uC000\u{1D55A}a;\u43B9uest\u803B\xBF\u40BF\u0100ci\u238A\u238Fr;\uC000\u{1D4BE}n\u0280;Edsv\u04F4\u239B\u239D\u23A1\u04F3;\u62F9ot;\u62F5\u0100;v\u23A6\u23A7\u62F4;\u62F3\u0100;i\u0777\u23AElde;\u4129\u01EB\u23B8\0\u23BCcy;\u4456l\u803B\xEF\u40EF\u0300cfmosu\u23CC\u23D7\u23DC\u23E1\u23E7\u23F5\u0100iy\u23D1\u23D5rc;\u4135;\u4439r;\uC000\u{1D527}ath;\u4237pf;\uC000\u{1D55B}\u01E3\u23EC\0\u23F1r;\uC000\u{1D4BF}rcy;\u4458kcy;\u4454\u0400acfghjos\u240B\u2416\u2422\u2427\u242D\u2431\u2435\u243Bppa\u0100;v\u2413\u2414\u43BA;\u43F0\u0100ey\u241B\u2420dil;\u4137;\u443Ar;\uC000\u{1D528}reen;\u4138cy;\u4445cy;\u445Cpf;\uC000\u{1D55C}cr;\uC000\u{1D4C0}\u0B80ABEHabcdefghjlmnoprstuv\u2470\u2481\u2486\u248D\u2491\u250E\u253D\u255A\u2580\u264E\u265E\u2665\u2679\u267D\u269A\u26B2\u26D8\u275D\u2768\u278B\u27C0\u2801\u2812\u0180art\u2477\u247A\u247Cr\xF2\u09C6\xF2\u0395ail;\u691Barr;\u690E\u0100;g\u0994\u248B;\u6A8Bar;\u6962\u0963\u24A5\0\u24AA\0\u24B1\0\0\0\0\0\u24B5\u24BA\0\u24C6\u24C8\u24CD\0\u24F9ute;\u413Amptyv;\u69B4ra\xEE\u084Cbda;\u43BBg\u0180;dl\u088E\u24C1\u24C3;\u6991\xE5\u088E;\u6A85uo\u803B\xAB\u40ABr\u0400;bfhlpst\u0899\u24DE\u24E6\u24E9\u24EB\u24EE\u24F1\u24F5\u0100;f\u089D\u24E3s;\u691Fs;\u691D\xEB\u2252p;\u61ABl;\u6939im;\u6973l;\u61A2\u0180;ae\u24FF\u2500\u2504\u6AABil;\u6919\u0100;s\u2509\u250A\u6AAD;\uC000\u2AAD\uFE00\u0180abr\u2515\u2519\u251Drr;\u690Crk;\u6772\u0100ak\u2522\u252Cc\u0100ek\u2528\u252A;\u407B;\u405B\u0100es\u2531\u2533;\u698Bl\u0100du\u2539\u253B;\u698F;\u698D\u0200aeuy\u2546\u254B\u2556\u2558ron;\u413E\u0100di\u2550\u2554il;\u413C\xEC\u08B0\xE2\u2529;\u443B\u0200cqrs\u2563\u2566\u256D\u257Da;\u6936uo\u0100;r\u0E19\u1746\u0100du\u2572\u2577har;\u6967shar;\u694Bh;\u61B2\u0280;fgqs\u258B\u258C\u0989\u25F3\u25FF\u6264t\u0280ahlrt\u2598\u25A4\u25B7\u25C2\u25E8rrow\u0100;t\u0899\u25A1a\xE9\u24F6arpoon\u0100du\u25AF\u25B4own\xBB\u045Ap\xBB\u0966eftarrows;\u61C7ight\u0180ahs\u25CD\u25D6\u25DErrow\u0100;s\u08F4\u08A7arpoon\xF3\u0F98quigarro\xF7\u21F0hreetimes;\u62CB\u0180;qs\u258B\u0993\u25FAlan\xF4\u09AC\u0280;cdgs\u09AC\u260A\u260D\u261D\u2628c;\u6AA8ot\u0100;o\u2614\u2615\u6A7F\u0100;r\u261A\u261B\u6A81;\u6A83\u0100;e\u2622\u2625\uC000\u22DA\uFE00s;\u6A93\u0280adegs\u2633\u2639\u263D\u2649\u264Bppro\xF8\u24C6ot;\u62D6q\u0100gq\u2643\u2645\xF4\u0989gt\xF2\u248C\xF4\u099Bi\xED\u09B2\u0180ilr\u2655\u08E1\u265Asht;\u697C;\uC000\u{1D529}\u0100;E\u099C\u2663;\u6A91\u0161\u2669\u2676r\u0100du\u25B2\u266E\u0100;l\u0965\u2673;\u696Alk;\u6584cy;\u4459\u0280;acht\u0A48\u2688\u268B\u2691\u2696r\xF2\u25C1orne\xF2\u1D08ard;\u696Bri;\u65FA\u0100io\u269F\u26A4dot;\u4140ust\u0100;a\u26AC\u26AD\u63B0che\xBB\u26AD\u0200Eaes\u26BB\u26BD\u26C9\u26D4;\u6268p\u0100;p\u26C3\u26C4\u6A89rox\xBB\u26C4\u0100;q\u26CE\u26CF\u6A87\u0100;q\u26CE\u26BBim;\u62E6\u0400abnoptwz\u26E9\u26F4\u26F7\u271A\u272F\u2741\u2747\u2750\u0100nr\u26EE\u26F1g;\u67ECr;\u61FDr\xEB\u08C1g\u0180lmr\u26FF\u270D\u2714eft\u0100ar\u09E6\u2707ight\xE1\u09F2apsto;\u67FCight\xE1\u09FDparrow\u0100lr\u2725\u2729ef\xF4\u24EDight;\u61AC\u0180afl\u2736\u2739\u273Dr;\u6985;\uC000\u{1D55D}us;\u6A2Dimes;\u6A34\u0161\u274B\u274Fst;\u6217\xE1\u134E\u0180;ef\u2757\u2758\u1800\u65CAnge\xBB\u2758ar\u0100;l\u2764\u2765\u4028t;\u6993\u0280achmt\u2773\u2776\u277C\u2785\u2787r\xF2\u08A8orne\xF2\u1D8Car\u0100;d\u0F98\u2783;\u696D;\u600Eri;\u62BF\u0300achiqt\u2798\u279D\u0A40\u27A2\u27AE\u27BBquo;\u6039r;\uC000\u{1D4C1}m\u0180;eg\u09B2\u27AA\u27AC;\u6A8D;\u6A8F\u0100bu\u252A\u27B3o\u0100;r\u0E1F\u27B9;\u601Arok;\u4142\u8400<;cdhilqr\u082B\u27D2\u2639\u27DC\u27E0\u27E5\u27EA\u27F0\u0100ci\u27D7\u27D9;\u6AA6r;\u6A79re\xE5\u25F2mes;\u62C9arr;\u6976uest;\u6A7B\u0100Pi\u27F5\u27F9ar;\u6996\u0180;ef\u2800\u092D\u181B\u65C3r\u0100du\u2807\u280Dshar;\u694Ahar;\u6966\u0100en\u2817\u2821rtneqq;\uC000\u2268\uFE00\xC5\u281E\u0700Dacdefhilnopsu\u2840\u2845\u2882\u288E\u2893\u28A0\u28A5\u28A8\u28DA\u28E2\u28E4\u0A83\u28F3\u2902Dot;\u623A\u0200clpr\u284E\u2852\u2863\u287Dr\u803B\xAF\u40AF\u0100et\u2857\u2859;\u6642\u0100;e\u285E\u285F\u6720se\xBB\u285F\u0100;s\u103B\u2868to\u0200;dlu\u103B\u2873\u2877\u287Bow\xEE\u048Cef\xF4\u090F\xF0\u13D1ker;\u65AE\u0100oy\u2887\u288Cmma;\u6A29;\u443Cash;\u6014asuredangle\xBB\u1626r;\uC000\u{1D52A}o;\u6127\u0180cdn\u28AF\u28B4\u28C9ro\u803B\xB5\u40B5\u0200;acd\u1464\u28BD\u28C0\u28C4s\xF4\u16A7ir;\u6AF0ot\u80BB\xB7\u01B5us\u0180;bd\u28D2\u1903\u28D3\u6212\u0100;u\u1D3C\u28D8;\u6A2A\u0163\u28DE\u28E1p;\u6ADB\xF2\u2212\xF0\u0A81\u0100dp\u28E9\u28EEels;\u62A7f;\uC000\u{1D55E}\u0100ct\u28F8\u28FDr;\uC000\u{1D4C2}pos\xBB\u159D\u0180;lm\u2909\u290A\u290D\u43BCtimap;\u62B8\u0C00GLRVabcdefghijlmoprstuvw\u2942\u2953\u297E\u2989\u2998\u29DA\u29E9\u2A15\u2A1A\u2A58\u2A5D\u2A83\u2A95\u2AA4\u2AA8\u2B04\u2B07\u2B44\u2B7F\u2BAE\u2C34\u2C67\u2C7C\u2CE9\u0100gt\u2947\u294B;\uC000\u22D9\u0338\u0100;v\u2950\u0BCF\uC000\u226B\u20D2\u0180elt\u295A\u2972\u2976ft\u0100ar\u2961\u2967rrow;\u61CDightarrow;\u61CE;\uC000\u22D8\u0338\u0100;v\u297B\u0C47\uC000\u226A\u20D2ightarrow;\u61CF\u0100Dd\u298E\u2993ash;\u62AFash;\u62AE\u0280bcnpt\u29A3\u29A7\u29AC\u29B1\u29CCla\xBB\u02DEute;\u4144g;\uC000\u2220\u20D2\u0280;Eiop\u0D84\u29BC\u29C0\u29C5\u29C8;\uC000\u2A70\u0338d;\uC000\u224B\u0338s;\u4149ro\xF8\u0D84ur\u0100;a\u29D3\u29D4\u666El\u0100;s\u29D3\u0B38\u01F3\u29DF\0\u29E3p\u80BB\xA0\u0B37mp\u0100;e\u0BF9\u0C00\u0280aeouy\u29F4\u29FE\u2A03\u2A10\u2A13\u01F0\u29F9\0\u29FB;\u6A43on;\u4148dil;\u4146ng\u0100;d\u0D7E\u2A0Aot;\uC000\u2A6D\u0338p;\u6A42;\u443Dash;\u6013\u0380;Aadqsx\u0B92\u2A29\u2A2D\u2A3B\u2A41\u2A45\u2A50rr;\u61D7r\u0100hr\u2A33\u2A36k;\u6924\u0100;o\u13F2\u13F0ot;\uC000\u2250\u0338ui\xF6\u0B63\u0100ei\u2A4A\u2A4Ear;\u6928\xED\u0B98ist\u0100;s\u0BA0\u0B9Fr;\uC000\u{1D52B}\u0200Eest\u0BC5\u2A66\u2A79\u2A7C\u0180;qs\u0BBC\u2A6D\u0BE1\u0180;qs\u0BBC\u0BC5\u2A74lan\xF4\u0BE2i\xED\u0BEA\u0100;r\u0BB6\u2A81\xBB\u0BB7\u0180Aap\u2A8A\u2A8D\u2A91r\xF2\u2971rr;\u61AEar;\u6AF2\u0180;sv\u0F8D\u2A9C\u0F8C\u0100;d\u2AA1\u2AA2\u62FC;\u62FAcy;\u445A\u0380AEadest\u2AB7\u2ABA\u2ABE\u2AC2\u2AC5\u2AF6\u2AF9r\xF2\u2966;\uC000\u2266\u0338rr;\u619Ar;\u6025\u0200;fqs\u0C3B\u2ACE\u2AE3\u2AEFt\u0100ar\u2AD4\u2AD9rro\xF7\u2AC1ightarro\xF7\u2A90\u0180;qs\u0C3B\u2ABA\u2AEAlan\xF4\u0C55\u0100;s\u0C55\u2AF4\xBB\u0C36i\xED\u0C5D\u0100;r\u0C35\u2AFEi\u0100;e\u0C1A\u0C25i\xE4\u0D90\u0100pt\u2B0C\u2B11f;\uC000\u{1D55F}\u8180\xAC;in\u2B19\u2B1A\u2B36\u40ACn\u0200;Edv\u0B89\u2B24\u2B28\u2B2E;\uC000\u22F9\u0338ot;\uC000\u22F5\u0338\u01E1\u0B89\u2B33\u2B35;\u62F7;\u62F6i\u0100;v\u0CB8\u2B3C\u01E1\u0CB8\u2B41\u2B43;\u62FE;\u62FD\u0180aor\u2B4B\u2B63\u2B69r\u0200;ast\u0B7B\u2B55\u2B5A\u2B5Flle\xEC\u0B7Bl;\uC000\u2AFD\u20E5;\uC000\u2202\u0338lint;\u6A14\u0180;ce\u0C92\u2B70\u2B73u\xE5\u0CA5\u0100;c\u0C98\u2B78\u0100;e\u0C92\u2B7D\xF1\u0C98\u0200Aait\u2B88\u2B8B\u2B9D\u2BA7r\xF2\u2988rr\u0180;cw\u2B94\u2B95\u2B99\u619B;\uC000\u2933\u0338;\uC000\u219D\u0338ghtarrow\xBB\u2B95ri\u0100;e\u0CCB\u0CD6\u0380chimpqu\u2BBD\u2BCD\u2BD9\u2B04\u0B78\u2BE4\u2BEF\u0200;cer\u0D32\u2BC6\u0D37\u2BC9u\xE5\u0D45;\uC000\u{1D4C3}ort\u026D\u2B05\0\0\u2BD6ar\xE1\u2B56m\u0100;e\u0D6E\u2BDF\u0100;q\u0D74\u0D73su\u0100bp\u2BEB\u2BED\xE5\u0CF8\xE5\u0D0B\u0180bcp\u2BF6\u2C11\u2C19\u0200;Ees\u2BFF\u2C00\u0D22\u2C04\u6284;\uC000\u2AC5\u0338et\u0100;e\u0D1B\u2C0Bq\u0100;q\u0D23\u2C00c\u0100;e\u0D32\u2C17\xF1\u0D38\u0200;Ees\u2C22\u2C23\u0D5F\u2C27\u6285;\uC000\u2AC6\u0338et\u0100;e\u0D58\u2C2Eq\u0100;q\u0D60\u2C23\u0200gilr\u2C3D\u2C3F\u2C45\u2C47\xEC\u0BD7lde\u803B\xF1\u40F1\xE7\u0C43iangle\u0100lr\u2C52\u2C5Ceft\u0100;e\u0C1A\u2C5A\xF1\u0C26ight\u0100;e\u0CCB\u2C65\xF1\u0CD7\u0100;m\u2C6C\u2C6D\u43BD\u0180;es\u2C74\u2C75\u2C79\u4023ro;\u6116p;\u6007\u0480DHadgilrs\u2C8F\u2C94\u2C99\u2C9E\u2CA3\u2CB0\u2CB6\u2CD3\u2CE3ash;\u62ADarr;\u6904p;\uC000\u224D\u20D2ash;\u62AC\u0100et\u2CA8\u2CAC;\uC000\u2265\u20D2;\uC000>\u20D2nfin;\u69DE\u0180Aet\u2CBD\u2CC1\u2CC5rr;\u6902;\uC000\u2264\u20D2\u0100;r\u2CCA\u2CCD\uC000<\u20D2ie;\uC000\u22B4\u20D2\u0100At\u2CD8\u2CDCrr;\u6903rie;\uC000\u22B5\u20D2im;\uC000\u223C\u20D2\u0180Aan\u2CF0\u2CF4\u2D02rr;\u61D6r\u0100hr\u2CFA\u2CFDk;\u6923\u0100;o\u13E7\u13E5ear;\u6927\u1253\u1A95\0\0\0\0\0\0\0\0\0\0\0\0\0\u2D2D\0\u2D38\u2D48\u2D60\u2D65\u2D72\u2D84\u1B07\0\0\u2D8D\u2DAB\0\u2DC8\u2DCE\0\u2DDC\u2E19\u2E2B\u2E3E\u2E43\u0100cs\u2D31\u1A97ute\u803B\xF3\u40F3\u0100iy\u2D3C\u2D45r\u0100;c\u1A9E\u2D42\u803B\xF4\u40F4;\u443E\u0280abios\u1AA0\u2D52\u2D57\u01C8\u2D5Alac;\u4151v;\u6A38old;\u69BClig;\u4153\u0100cr\u2D69\u2D6Dir;\u69BF;\uC000\u{1D52C}\u036F\u2D79\0\0\u2D7C\0\u2D82n;\u42DBave\u803B\xF2\u40F2;\u69C1\u0100bm\u2D88\u0DF4ar;\u69B5\u0200acit\u2D95\u2D98\u2DA5\u2DA8r\xF2\u1A80\u0100ir\u2D9D\u2DA0r;\u69BEoss;\u69BBn\xE5\u0E52;\u69C0\u0180aei\u2DB1\u2DB5\u2DB9cr;\u414Dga;\u43C9\u0180cdn\u2DC0\u2DC5\u01CDron;\u43BF;\u69B6pf;\uC000\u{1D560}\u0180ael\u2DD4\u2DD7\u01D2r;\u69B7rp;\u69B9\u0380;adiosv\u2DEA\u2DEB\u2DEE\u2E08\u2E0D\u2E10\u2E16\u6228r\xF2\u1A86\u0200;efm\u2DF7\u2DF8\u2E02\u2E05\u6A5Dr\u0100;o\u2DFE\u2DFF\u6134f\xBB\u2DFF\u803B\xAA\u40AA\u803B\xBA\u40BAgof;\u62B6r;\u6A56lope;\u6A57;\u6A5B\u0180clo\u2E1F\u2E21\u2E27\xF2\u2E01ash\u803B\xF8\u40F8l;\u6298i\u016C\u2E2F\u2E34de\u803B\xF5\u40F5es\u0100;a\u01DB\u2E3As;\u6A36ml\u803B\xF6\u40F6bar;\u633D\u0AE1\u2E5E\0\u2E7D\0\u2E80\u2E9D\0\u2EA2\u2EB9\0\0\u2ECB\u0E9C\0\u2F13\0\0\u2F2B\u2FBC\0\u2FC8r\u0200;ast\u0403\u2E67\u2E72\u0E85\u8100\xB6;l\u2E6D\u2E6E\u40B6le\xEC\u0403\u0269\u2E78\0\0\u2E7Bm;\u6AF3;\u6AFDy;\u443Fr\u0280cimpt\u2E8B\u2E8F\u2E93\u1865\u2E97nt;\u4025od;\u402Eil;\u6030enk;\u6031r;\uC000\u{1D52D}\u0180imo\u2EA8\u2EB0\u2EB4\u0100;v\u2EAD\u2EAE\u43C6;\u43D5ma\xF4\u0A76ne;\u660E\u0180;tv\u2EBF\u2EC0\u2EC8\u43C0chfork\xBB\u1FFD;\u43D6\u0100au\u2ECF\u2EDFn\u0100ck\u2ED5\u2EDDk\u0100;h\u21F4\u2EDB;\u610E\xF6\u21F4s\u0480;abcdemst\u2EF3\u2EF4\u1908\u2EF9\u2EFD\u2F04\u2F06\u2F0A\u2F0E\u402Bcir;\u6A23ir;\u6A22\u0100ou\u1D40\u2F02;\u6A25;\u6A72n\u80BB\xB1\u0E9Dim;\u6A26wo;\u6A27\u0180ipu\u2F19\u2F20\u2F25ntint;\u6A15f;\uC000\u{1D561}nd\u803B\xA3\u40A3\u0500;Eaceinosu\u0EC8\u2F3F\u2F41\u2F44\u2F47\u2F81\u2F89\u2F92\u2F7E\u2FB6;\u6AB3p;\u6AB7u\xE5\u0ED9\u0100;c\u0ECE\u2F4C\u0300;acens\u0EC8\u2F59\u2F5F\u2F66\u2F68\u2F7Eppro\xF8\u2F43urlye\xF1\u0ED9\xF1\u0ECE\u0180aes\u2F6F\u2F76\u2F7Approx;\u6AB9qq;\u6AB5im;\u62E8i\xED\u0EDFme\u0100;s\u2F88\u0EAE\u6032\u0180Eas\u2F78\u2F90\u2F7A\xF0\u2F75\u0180dfp\u0EEC\u2F99\u2FAF\u0180als\u2FA0\u2FA5\u2FAAlar;\u632Eine;\u6312urf;\u6313\u0100;t\u0EFB\u2FB4\xEF\u0EFBrel;\u62B0\u0100ci\u2FC0\u2FC5r;\uC000\u{1D4C5};\u43C8ncsp;\u6008\u0300fiopsu\u2FDA\u22E2\u2FDF\u2FE5\u2FEB\u2FF1r;\uC000\u{1D52E}pf;\uC000\u{1D562}rime;\u6057cr;\uC000\u{1D4C6}\u0180aeo\u2FF8\u3009\u3013t\u0100ei\u2FFE\u3005rnion\xF3\u06B0nt;\u6A16st\u0100;e\u3010\u3011\u403F\xF1\u1F19\xF4\u0F14\u0A80ABHabcdefhilmnoprstux\u3040\u3051\u3055\u3059\u30E0\u310E\u312B\u3147\u3162\u3172\u318E\u3206\u3215\u3224\u3229\u3258\u326E\u3272\u3290\u32B0\u32B7\u0180art\u3047\u304A\u304Cr\xF2\u10B3\xF2\u03DDail;\u691Car\xF2\u1C65ar;\u6964\u0380cdenqrt\u3068\u3075\u3078\u307F\u308F\u3094\u30CC\u0100eu\u306D\u3071;\uC000\u223D\u0331te;\u4155i\xE3\u116Emptyv;\u69B3g\u0200;del\u0FD1\u3089\u308B\u308D;\u6992;\u69A5\xE5\u0FD1uo\u803B\xBB\u40BBr\u0580;abcfhlpstw\u0FDC\u30AC\u30AF\u30B7\u30B9\u30BC\u30BE\u30C0\u30C3\u30C7\u30CAp;\u6975\u0100;f\u0FE0\u30B4s;\u6920;\u6933s;\u691E\xEB\u225D\xF0\u272El;\u6945im;\u6974l;\u61A3;\u619D\u0100ai\u30D1\u30D5il;\u691Ao\u0100;n\u30DB\u30DC\u6236al\xF3\u0F1E\u0180abr\u30E7\u30EA\u30EEr\xF2\u17E5rk;\u6773\u0100ak\u30F3\u30FDc\u0100ek\u30F9\u30FB;\u407D;\u405D\u0100es\u3102\u3104;\u698Cl\u0100du\u310A\u310C;\u698E;\u6990\u0200aeuy\u3117\u311C\u3127\u3129ron;\u4159\u0100di\u3121\u3125il;\u4157\xEC\u0FF2\xE2\u30FA;\u4440\u0200clqs\u3134\u3137\u313D\u3144a;\u6937dhar;\u6969uo\u0100;r\u020E\u020Dh;\u61B3\u0180acg\u314E\u315F\u0F44l\u0200;ips\u0F78\u3158\u315B\u109Cn\xE5\u10BBar\xF4\u0FA9t;\u65AD\u0180ilr\u3169\u1023\u316Esht;\u697D;\uC000\u{1D52F}\u0100ao\u3177\u3186r\u0100du\u317D\u317F\xBB\u047B\u0100;l\u1091\u3184;\u696C\u0100;v\u318B\u318C\u43C1;\u43F1\u0180gns\u3195\u31F9\u31FCht\u0300ahlrst\u31A4\u31B0\u31C2\u31D8\u31E4\u31EErrow\u0100;t\u0FDC\u31ADa\xE9\u30C8arpoon\u0100du\u31BB\u31BFow\xEE\u317Ep\xBB\u1092eft\u0100ah\u31CA\u31D0rrow\xF3\u0FEAarpoon\xF3\u0551ightarrows;\u61C9quigarro\xF7\u30CBhreetimes;\u62CCg;\u42DAingdotse\xF1\u1F32\u0180ahm\u320D\u3210\u3213r\xF2\u0FEAa\xF2\u0551;\u600Foust\u0100;a\u321E\u321F\u63B1che\xBB\u321Fmid;\u6AEE\u0200abpt\u3232\u323D\u3240\u3252\u0100nr\u3237\u323Ag;\u67EDr;\u61FEr\xEB\u1003\u0180afl\u3247\u324A\u324Er;\u6986;\uC000\u{1D563}us;\u6A2Eimes;\u6A35\u0100ap\u325D\u3267r\u0100;g\u3263\u3264\u4029t;\u6994olint;\u6A12ar\xF2\u31E3\u0200achq\u327B\u3280\u10BC\u3285quo;\u603Ar;\uC000\u{1D4C7}\u0100bu\u30FB\u328Ao\u0100;r\u0214\u0213\u0180hir\u3297\u329B\u32A0re\xE5\u31F8mes;\u62CAi\u0200;efl\u32AA\u1059\u1821\u32AB\u65B9tri;\u69CEluhar;\u6968;\u611E\u0D61\u32D5\u32DB\u32DF\u332C\u3338\u3371\0\u337A\u33A4\0\0\u33EC\u33F0\0\u3428\u3448\u345A\u34AD\u34B1\u34CA\u34F1\0\u3616\0\0\u3633cute;\u415Bqu\xEF\u27BA\u0500;Eaceinpsy\u11ED\u32F3\u32F5\u32FF\u3302\u330B\u330F\u331F\u3326\u3329;\u6AB4\u01F0\u32FA\0\u32FC;\u6AB8on;\u4161u\xE5\u11FE\u0100;d\u11F3\u3307il;\u415Frc;\u415D\u0180Eas\u3316\u3318\u331B;\u6AB6p;\u6ABAim;\u62E9olint;\u6A13i\xED\u1204;\u4441ot\u0180;be\u3334\u1D47\u3335\u62C5;\u6A66\u0380Aacmstx\u3346\u334A\u3357\u335B\u335E\u3363\u336Drr;\u61D8r\u0100hr\u3350\u3352\xEB\u2228\u0100;o\u0A36\u0A34t\u803B\xA7\u40A7i;\u403Bwar;\u6929m\u0100in\u3369\xF0nu\xF3\xF1t;\u6736r\u0100;o\u3376\u2055\uC000\u{1D530}\u0200acoy\u3382\u3386\u3391\u33A0rp;\u666F\u0100hy\u338B\u338Fcy;\u4449;\u4448rt\u026D\u3399\0\0\u339Ci\xE4\u1464ara\xEC\u2E6F\u803B\xAD\u40AD\u0100gm\u33A8\u33B4ma\u0180;fv\u33B1\u33B2\u33B2\u43C3;\u43C2\u0400;deglnpr\u12AB\u33C5\u33C9\u33CE\u33D6\u33DE\u33E1\u33E6ot;\u6A6A\u0100;q\u12B1\u12B0\u0100;E\u33D3\u33D4\u6A9E;\u6AA0\u0100;E\u33DB\u33DC\u6A9D;\u6A9Fe;\u6246lus;\u6A24arr;\u6972ar\xF2\u113D\u0200aeit\u33F8\u3408\u340F\u3417\u0100ls\u33FD\u3404lsetm\xE9\u336Ahp;\u6A33parsl;\u69E4\u0100dl\u1463\u3414e;\u6323\u0100;e\u341C\u341D\u6AAA\u0100;s\u3422\u3423\u6AAC;\uC000\u2AAC\uFE00\u0180flp\u342E\u3433\u3442tcy;\u444C\u0100;b\u3438\u3439\u402F\u0100;a\u343E\u343F\u69C4r;\u633Ff;\uC000\u{1D564}a\u0100dr\u344D\u0402es\u0100;u\u3454\u3455\u6660it\xBB\u3455\u0180csu\u3460\u3479\u349F\u0100au\u3465\u346Fp\u0100;s\u1188\u346B;\uC000\u2293\uFE00p\u0100;s\u11B4\u3475;\uC000\u2294\uFE00u\u0100bp\u347F\u348F\u0180;es\u1197\u119C\u3486et\u0100;e\u1197\u348D\xF1\u119D\u0180;es\u11A8\u11AD\u3496et\u0100;e\u11A8\u349D\xF1\u11AE\u0180;af\u117B\u34A6\u05B0r\u0165\u34AB\u05B1\xBB\u117Car\xF2\u1148\u0200cemt\u34B9\u34BE\u34C2\u34C5r;\uC000\u{1D4C8}tm\xEE\xF1i\xEC\u3415ar\xE6\u11BE\u0100ar\u34CE\u34D5r\u0100;f\u34D4\u17BF\u6606\u0100an\u34DA\u34EDight\u0100ep\u34E3\u34EApsilo\xEE\u1EE0h\xE9\u2EAFs\xBB\u2852\u0280bcmnp\u34FB\u355E\u1209\u358B\u358E\u0480;Edemnprs\u350E\u350F\u3511\u3515\u351E\u3523\u352C\u3531\u3536\u6282;\u6AC5ot;\u6ABD\u0100;d\u11DA\u351Aot;\u6AC3ult;\u6AC1\u0100Ee\u3528\u352A;\u6ACB;\u628Alus;\u6ABFarr;\u6979\u0180eiu\u353D\u3552\u3555t\u0180;en\u350E\u3545\u354Bq\u0100;q\u11DA\u350Feq\u0100;q\u352B\u3528m;\u6AC7\u0100bp\u355A\u355C;\u6AD5;\u6AD3c\u0300;acens\u11ED\u356C\u3572\u3579\u357B\u3326ppro\xF8\u32FAurlye\xF1\u11FE\xF1\u11F3\u0180aes\u3582\u3588\u331Bppro\xF8\u331Aq\xF1\u3317g;\u666A\u0680123;Edehlmnps\u35A9\u35AC\u35AF\u121C\u35B2\u35B4\u35C0\u35C9\u35D5\u35DA\u35DF\u35E8\u35ED\u803B\xB9\u40B9\u803B\xB2\u40B2\u803B\xB3\u40B3;\u6AC6\u0100os\u35B9\u35BCt;\u6ABEub;\u6AD8\u0100;d\u1222\u35C5ot;\u6AC4s\u0100ou\u35CF\u35D2l;\u67C9b;\u6AD7arr;\u697Bult;\u6AC2\u0100Ee\u35E4\u35E6;\u6ACC;\u628Blus;\u6AC0\u0180eiu\u35F4\u3609\u360Ct\u0180;en\u121C\u35FC\u3602q\u0100;q\u1222\u35B2eq\u0100;q\u35E7\u35E4m;\u6AC8\u0100bp\u3611\u3613;\u6AD4;\u6AD6\u0180Aan\u361C\u3620\u362Drr;\u61D9r\u0100hr\u3626\u3628\xEB\u222E\u0100;o\u0A2B\u0A29war;\u692Alig\u803B\xDF\u40DF\u0BE1\u3651\u365D\u3660\u12CE\u3673\u3679\0\u367E\u36C2\0\0\0\0\0\u36DB\u3703\0\u3709\u376C\0\0\0\u3787\u0272\u3656\0\0\u365Bget;\u6316;\u43C4r\xEB\u0E5F\u0180aey\u3666\u366B\u3670ron;\u4165dil;\u4163;\u4442lrec;\u6315r;\uC000\u{1D531}\u0200eiko\u3686\u369D\u36B5\u36BC\u01F2\u368B\0\u3691e\u01004f\u1284\u1281a\u0180;sv\u3698\u3699\u369B\u43B8ym;\u43D1\u0100cn\u36A2\u36B2k\u0100as\u36A8\u36AEppro\xF8\u12C1im\xBB\u12ACs\xF0\u129E\u0100as\u36BA\u36AE\xF0\u12C1rn\u803B\xFE\u40FE\u01EC\u031F\u36C6\u22E7es\u8180\xD7;bd\u36CF\u36D0\u36D8\u40D7\u0100;a\u190F\u36D5r;\u6A31;\u6A30\u0180eps\u36E1\u36E3\u3700\xE1\u2A4D\u0200;bcf\u0486\u36EC\u36F0\u36F4ot;\u6336ir;\u6AF1\u0100;o\u36F9\u36FC\uC000\u{1D565}rk;\u6ADA\xE1\u3362rime;\u6034\u0180aip\u370F\u3712\u3764d\xE5\u1248\u0380adempst\u3721\u374D\u3740\u3751\u3757\u375C\u375Fngle\u0280;dlqr\u3730\u3731\u3736\u3740\u3742\u65B5own\xBB\u1DBBeft\u0100;e\u2800\u373E\xF1\u092E;\u625Cight\u0100;e\u32AA\u374B\xF1\u105Aot;\u65ECinus;\u6A3Alus;\u6A39b;\u69CDime;\u6A3Bezium;\u63E2\u0180cht\u3772\u377D\u3781\u0100ry\u3777\u377B;\uC000\u{1D4C9};\u4446cy;\u445Brok;\u4167\u0100io\u378B\u378Ex\xF4\u1777head\u0100lr\u3797\u37A0eftarro\xF7\u084Fightarrow\xBB\u0F5D\u0900AHabcdfghlmoprstuw\u37D0\u37D3\u37D7\u37E4\u37F0\u37FC\u380E\u381C\u3823\u3834\u3851\u385D\u386B\u38A9\u38CC\u38D2\u38EA\u38F6r\xF2\u03EDar;\u6963\u0100cr\u37DC\u37E2ute\u803B\xFA\u40FA\xF2\u1150r\u01E3\u37EA\0\u37EDy;\u445Eve;\u416D\u0100iy\u37F5\u37FArc\u803B\xFB\u40FB;\u4443\u0180abh\u3803\u3806\u380Br\xF2\u13ADlac;\u4171a\xF2\u13C3\u0100ir\u3813\u3818sht;\u697E;\uC000\u{1D532}rave\u803B\xF9\u40F9\u0161\u3827\u3831r\u0100lr\u382C\u382E\xBB\u0957\xBB\u1083lk;\u6580\u0100ct\u3839\u384D\u026F\u383F\0\0\u384Arn\u0100;e\u3845\u3846\u631Cr\xBB\u3846op;\u630Fri;\u65F8\u0100al\u3856\u385Acr;\u416B\u80BB\xA8\u0349\u0100gp\u3862\u3866on;\u4173f;\uC000\u{1D566}\u0300adhlsu\u114B\u3878\u387D\u1372\u3891\u38A0own\xE1\u13B3arpoon\u0100lr\u3888\u388Cef\xF4\u382Digh\xF4\u382Fi\u0180;hl\u3899\u389A\u389C\u43C5\xBB\u13FAon\xBB\u389Aparrows;\u61C8\u0180cit\u38B0\u38C4\u38C8\u026F\u38B6\0\0\u38C1rn\u0100;e\u38BC\u38BD\u631Dr\xBB\u38BDop;\u630Eng;\u416Fri;\u65F9cr;\uC000\u{1D4CA}\u0180dir\u38D9\u38DD\u38E2ot;\u62F0lde;\u4169i\u0100;f\u3730\u38E8\xBB\u1813\u0100am\u38EF\u38F2r\xF2\u38A8l\u803B\xFC\u40FCangle;\u69A7\u0780ABDacdeflnoprsz\u391C\u391F\u3929\u392D\u39B5\u39B8\u39BD\u39DF\u39E4\u39E8\u39F3\u39F9\u39FD\u3A01\u3A20r\xF2\u03F7ar\u0100;v\u3926\u3927\u6AE8;\u6AE9as\xE8\u03E1\u0100nr\u3932\u3937grt;\u699C\u0380eknprst\u34E3\u3946\u394B\u3952\u395D\u3964\u3996app\xE1\u2415othin\xE7\u1E96\u0180hir\u34EB\u2EC8\u3959op\xF4\u2FB5\u0100;h\u13B7\u3962\xEF\u318D\u0100iu\u3969\u396Dgm\xE1\u33B3\u0100bp\u3972\u3984setneq\u0100;q\u397D\u3980\uC000\u228A\uFE00;\uC000\u2ACB\uFE00setneq\u0100;q\u398F\u3992\uC000\u228B\uFE00;\uC000\u2ACC\uFE00\u0100hr\u399B\u399Fet\xE1\u369Ciangle\u0100lr\u39AA\u39AFeft\xBB\u0925ight\xBB\u1051y;\u4432ash\xBB\u1036\u0180elr\u39C4\u39D2\u39D7\u0180;be\u2DEA\u39CB\u39CFar;\u62BBq;\u625Alip;\u62EE\u0100bt\u39DC\u1468a\xF2\u1469r;\uC000\u{1D533}tr\xE9\u39AEsu\u0100bp\u39EF\u39F1\xBB\u0D1C\xBB\u0D59pf;\uC000\u{1D567}ro\xF0\u0EFBtr\xE9\u39B4\u0100cu\u3A06\u3A0Br;\uC000\u{1D4CB}\u0100bp\u3A10\u3A18n\u0100Ee\u3980\u3A16\xBB\u397En\u0100Ee\u3992\u3A1E\xBB\u3990igzag;\u699A\u0380cefoprs\u3A36\u3A3B\u3A56\u3A5B\u3A54\u3A61\u3A6Airc;\u4175\u0100di\u3A40\u3A51\u0100bg\u3A45\u3A49ar;\u6A5Fe\u0100;q\u15FA\u3A4F;\u6259erp;\u6118r;\uC000\u{1D534}pf;\uC000\u{1D568}\u0100;e\u1479\u3A66at\xE8\u1479cr;\uC000\u{1D4CC}\u0AE3\u178E\u3A87\0\u3A8B\0\u3A90\u3A9B\0\0\u3A9D\u3AA8\u3AAB\u3AAF\0\0\u3AC3\u3ACE\0\u3AD8\u17DC\u17DFtr\xE9\u17D1r;\uC000\u{1D535}\u0100Aa\u3A94\u3A97r\xF2\u03C3r\xF2\u09F6;\u43BE\u0100Aa\u3AA1\u3AA4r\xF2\u03B8r\xF2\u09EBa\xF0\u2713is;\u62FB\u0180dpt\u17A4\u3AB5\u3ABE\u0100fl\u3ABA\u17A9;\uC000\u{1D569}im\xE5\u17B2\u0100Aa\u3AC7\u3ACAr\xF2\u03CEr\xF2\u0A01\u0100cq\u3AD2\u17B8r;\uC000\u{1D4CD}\u0100pt\u17D6\u3ADCr\xE9\u17D4\u0400acefiosu\u3AF0\u3AFD\u3B08\u3B0C\u3B11\u3B15\u3B1B\u3B21c\u0100uy\u3AF6\u3AFBte\u803B\xFD\u40FD;\u444F\u0100iy\u3B02\u3B06rc;\u4177;\u444Bn\u803B\xA5\u40A5r;\uC000\u{1D536}cy;\u4457pf;\uC000\u{1D56A}cr;\uC000\u{1D4CE}\u0100cm\u3B26\u3B29y;\u444El\u803B\xFF\u40FF\u0500acdefhiosw\u3B42\u3B48\u3B54\u3B58\u3B64\u3B69\u3B6D\u3B74\u3B7A\u3B80cute;\u417A\u0100ay\u3B4D\u3B52ron;\u417E;\u4437ot;\u417C\u0100et\u3B5D\u3B61tr\xE6\u155Fa;\u43B6r;\uC000\u{1D537}cy;\u4436grarr;\u61DDpf;\uC000\u{1D56B}cr;\uC000\u{1D4CF}\u0100jn\u3B85\u3B87;\u600Dj;\u600C'.split("").map((c) => c.charCodeAt(0))
);

// node_modules/entities/dist/esm/decode-codepoint.js
var _a;
var decodeMap = /* @__PURE__ */ new Map([
  [0, 65533],
  // C1 Unicode control character reference replacements
  [128, 8364],
  [130, 8218],
  [131, 402],
  [132, 8222],
  [133, 8230],
  [134, 8224],
  [135, 8225],
  [136, 710],
  [137, 8240],
  [138, 352],
  [139, 8249],
  [140, 338],
  [142, 381],
  [145, 8216],
  [146, 8217],
  [147, 8220],
  [148, 8221],
  [149, 8226],
  [150, 8211],
  [151, 8212],
  [152, 732],
  [153, 8482],
  [154, 353],
  [155, 8250],
  [156, 339],
  [158, 382],
  [159, 376]
]);
var fromCodePoint = (
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, n/no-unsupported-features/es-builtins
  (_a = String.fromCodePoint) !== null && _a !== void 0 ? _a : function(codePoint) {
    let output = "";
    if (codePoint > 65535) {
      codePoint -= 65536;
      output += String.fromCharCode(codePoint >>> 10 & 1023 | 55296);
      codePoint = 56320 | codePoint & 1023;
    }
    output += String.fromCharCode(codePoint);
    return output;
  }
);
function replaceCodePoint(codePoint) {
  var _a2;
  if (codePoint >= 55296 && codePoint <= 57343 || codePoint > 1114111) {
    return 65533;
  }
  return (_a2 = decodeMap.get(codePoint)) !== null && _a2 !== void 0 ? _a2 : codePoint;
}

// node_modules/entities/dist/esm/decode.js
var CharCodes;
(function(CharCodes2) {
  CharCodes2[CharCodes2["NUM"] = 35] = "NUM";
  CharCodes2[CharCodes2["SEMI"] = 59] = "SEMI";
  CharCodes2[CharCodes2["EQUALS"] = 61] = "EQUALS";
  CharCodes2[CharCodes2["ZERO"] = 48] = "ZERO";
  CharCodes2[CharCodes2["NINE"] = 57] = "NINE";
  CharCodes2[CharCodes2["LOWER_A"] = 97] = "LOWER_A";
  CharCodes2[CharCodes2["LOWER_F"] = 102] = "LOWER_F";
  CharCodes2[CharCodes2["LOWER_X"] = 120] = "LOWER_X";
  CharCodes2[CharCodes2["LOWER_Z"] = 122] = "LOWER_Z";
  CharCodes2[CharCodes2["UPPER_A"] = 65] = "UPPER_A";
  CharCodes2[CharCodes2["UPPER_F"] = 70] = "UPPER_F";
  CharCodes2[CharCodes2["UPPER_Z"] = 90] = "UPPER_Z";
})(CharCodes || (CharCodes = {}));
var TO_LOWER_BIT = 32;
var BinTrieFlags;
(function(BinTrieFlags2) {
  BinTrieFlags2[BinTrieFlags2["VALUE_LENGTH"] = 49152] = "VALUE_LENGTH";
  BinTrieFlags2[BinTrieFlags2["BRANCH_LENGTH"] = 16256] = "BRANCH_LENGTH";
  BinTrieFlags2[BinTrieFlags2["JUMP_TABLE"] = 127] = "JUMP_TABLE";
})(BinTrieFlags || (BinTrieFlags = {}));
function isNumber(code) {
  return code >= CharCodes.ZERO && code <= CharCodes.NINE;
}
function isHexadecimalCharacter(code) {
  return code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_F || code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_F;
}
function isAsciiAlphaNumeric(code) {
  return code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_Z || code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_Z || isNumber(code);
}
function isEntityInAttributeInvalidEnd(code) {
  return code === CharCodes.EQUALS || isAsciiAlphaNumeric(code);
}
var EntityDecoderState;
(function(EntityDecoderState2) {
  EntityDecoderState2[EntityDecoderState2["EntityStart"] = 0] = "EntityStart";
  EntityDecoderState2[EntityDecoderState2["NumericStart"] = 1] = "NumericStart";
  EntityDecoderState2[EntityDecoderState2["NumericDecimal"] = 2] = "NumericDecimal";
  EntityDecoderState2[EntityDecoderState2["NumericHex"] = 3] = "NumericHex";
  EntityDecoderState2[EntityDecoderState2["NamedEntity"] = 4] = "NamedEntity";
})(EntityDecoderState || (EntityDecoderState = {}));
var DecodingMode;
(function(DecodingMode2) {
  DecodingMode2[DecodingMode2["Legacy"] = 0] = "Legacy";
  DecodingMode2[DecodingMode2["Strict"] = 1] = "Strict";
  DecodingMode2[DecodingMode2["Attribute"] = 2] = "Attribute";
})(DecodingMode || (DecodingMode = {}));
var EntityDecoder = class {
  constructor(decodeTree, emitCodePoint, errors) {
    this.decodeTree = decodeTree;
    this.emitCodePoint = emitCodePoint;
    this.errors = errors;
    this.state = EntityDecoderState.EntityStart;
    this.consumed = 1;
    this.result = 0;
    this.treeIndex = 0;
    this.excess = 1;
    this.decodeMode = DecodingMode.Strict;
  }
  /** Resets the instance to make it reusable. */
  startEntity(decodeMode) {
    this.decodeMode = decodeMode;
    this.state = EntityDecoderState.EntityStart;
    this.result = 0;
    this.treeIndex = 0;
    this.excess = 1;
    this.consumed = 1;
  }
  /**
   * Write an entity to the decoder. This can be called multiple times with partial entities.
   * If the entity is incomplete, the decoder will return -1.
   *
   * Mirrors the implementation of `getDecoder`, but with the ability to stop decoding if the
   * entity is incomplete, and resume when the next string is written.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The offset at which the entity begins. Should be 0 if this is not the first call.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  write(input, offset) {
    switch (this.state) {
      case EntityDecoderState.EntityStart: {
        if (input.charCodeAt(offset) === CharCodes.NUM) {
          this.state = EntityDecoderState.NumericStart;
          this.consumed += 1;
          return this.stateNumericStart(input, offset + 1);
        }
        this.state = EntityDecoderState.NamedEntity;
        return this.stateNamedEntity(input, offset);
      }
      case EntityDecoderState.NumericStart: {
        return this.stateNumericStart(input, offset);
      }
      case EntityDecoderState.NumericDecimal: {
        return this.stateNumericDecimal(input, offset);
      }
      case EntityDecoderState.NumericHex: {
        return this.stateNumericHex(input, offset);
      }
      case EntityDecoderState.NamedEntity: {
        return this.stateNamedEntity(input, offset);
      }
    }
  }
  /**
   * Switches between the numeric decimal and hexadecimal states.
   *
   * Equivalent to the `Numeric character reference state` in the HTML spec.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The current offset.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  stateNumericStart(input, offset) {
    if (offset >= input.length) {
      return -1;
    }
    if ((input.charCodeAt(offset) | TO_LOWER_BIT) === CharCodes.LOWER_X) {
      this.state = EntityDecoderState.NumericHex;
      this.consumed += 1;
      return this.stateNumericHex(input, offset + 1);
    }
    this.state = EntityDecoderState.NumericDecimal;
    return this.stateNumericDecimal(input, offset);
  }
  addToNumericResult(input, start, end, base) {
    if (start !== end) {
      const digitCount = end - start;
      this.result = this.result * Math.pow(base, digitCount) + Number.parseInt(input.substr(start, digitCount), base);
      this.consumed += digitCount;
    }
  }
  /**
   * Parses a hexadecimal numeric entity.
   *
   * Equivalent to the `Hexademical character reference state` in the HTML spec.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The current offset.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  stateNumericHex(input, offset) {
    const startIndex = offset;
    while (offset < input.length) {
      const char = input.charCodeAt(offset);
      if (isNumber(char) || isHexadecimalCharacter(char)) {
        offset += 1;
      } else {
        this.addToNumericResult(input, startIndex, offset, 16);
        return this.emitNumericEntity(char, 3);
      }
    }
    this.addToNumericResult(input, startIndex, offset, 16);
    return -1;
  }
  /**
   * Parses a decimal numeric entity.
   *
   * Equivalent to the `Decimal character reference state` in the HTML spec.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The current offset.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  stateNumericDecimal(input, offset) {
    const startIndex = offset;
    while (offset < input.length) {
      const char = input.charCodeAt(offset);
      if (isNumber(char)) {
        offset += 1;
      } else {
        this.addToNumericResult(input, startIndex, offset, 10);
        return this.emitNumericEntity(char, 2);
      }
    }
    this.addToNumericResult(input, startIndex, offset, 10);
    return -1;
  }
  /**
   * Validate and emit a numeric entity.
   *
   * Implements the logic from the `Hexademical character reference start
   * state` and `Numeric character reference end state` in the HTML spec.
   *
   * @param lastCp The last code point of the entity. Used to see if the
   *               entity was terminated with a semicolon.
   * @param expectedLength The minimum number of characters that should be
   *                       consumed. Used to validate that at least one digit
   *                       was consumed.
   * @returns The number of characters that were consumed.
   */
  emitNumericEntity(lastCp, expectedLength) {
    var _a2;
    if (this.consumed <= expectedLength) {
      (_a2 = this.errors) === null || _a2 === void 0 ? void 0 : _a2.absenceOfDigitsInNumericCharacterReference(this.consumed);
      return 0;
    }
    if (lastCp === CharCodes.SEMI) {
      this.consumed += 1;
    } else if (this.decodeMode === DecodingMode.Strict) {
      return 0;
    }
    this.emitCodePoint(replaceCodePoint(this.result), this.consumed);
    if (this.errors) {
      if (lastCp !== CharCodes.SEMI) {
        this.errors.missingSemicolonAfterCharacterReference();
      }
      this.errors.validateNumericCharacterReference(this.result);
    }
    return this.consumed;
  }
  /**
   * Parses a named entity.
   *
   * Equivalent to the `Named character reference state` in the HTML spec.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The current offset.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  stateNamedEntity(input, offset) {
    const { decodeTree } = this;
    let current = decodeTree[this.treeIndex];
    let valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
    for (; offset < input.length; offset++, this.excess++) {
      const char = input.charCodeAt(offset);
      this.treeIndex = determineBranch(decodeTree, current, this.treeIndex + Math.max(1, valueLength), char);
      if (this.treeIndex < 0) {
        return this.result === 0 || // If we are parsing an attribute
        this.decodeMode === DecodingMode.Attribute && // We shouldn't have consumed any characters after the entity,
        (valueLength === 0 || // And there should be no invalid characters.
        isEntityInAttributeInvalidEnd(char)) ? 0 : this.emitNotTerminatedNamedEntity();
      }
      current = decodeTree[this.treeIndex];
      valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
      if (valueLength !== 0) {
        if (char === CharCodes.SEMI) {
          return this.emitNamedEntityData(this.treeIndex, valueLength, this.consumed + this.excess);
        }
        if (this.decodeMode !== DecodingMode.Strict) {
          this.result = this.treeIndex;
          this.consumed += this.excess;
          this.excess = 0;
        }
      }
    }
    return -1;
  }
  /**
   * Emit a named entity that was not terminated with a semicolon.
   *
   * @returns The number of characters consumed.
   */
  emitNotTerminatedNamedEntity() {
    var _a2;
    const { result, decodeTree } = this;
    const valueLength = (decodeTree[result] & BinTrieFlags.VALUE_LENGTH) >> 14;
    this.emitNamedEntityData(result, valueLength, this.consumed);
    (_a2 = this.errors) === null || _a2 === void 0 ? void 0 : _a2.missingSemicolonAfterCharacterReference();
    return this.consumed;
  }
  /**
   * Emit a named entity.
   *
   * @param result The index of the entity in the decode tree.
   * @param valueLength The number of bytes in the entity.
   * @param consumed The number of characters consumed.
   *
   * @returns The number of characters consumed.
   */
  emitNamedEntityData(result, valueLength, consumed) {
    const { decodeTree } = this;
    this.emitCodePoint(valueLength === 1 ? decodeTree[result] & ~BinTrieFlags.VALUE_LENGTH : decodeTree[result + 1], consumed);
    if (valueLength === 3) {
      this.emitCodePoint(decodeTree[result + 2], consumed);
    }
    return consumed;
  }
  /**
   * Signal to the parser that the end of the input was reached.
   *
   * Remaining data will be emitted and relevant errors will be produced.
   *
   * @returns The number of characters consumed.
   */
  end() {
    var _a2;
    switch (this.state) {
      case EntityDecoderState.NamedEntity: {
        return this.result !== 0 && (this.decodeMode !== DecodingMode.Attribute || this.result === this.treeIndex) ? this.emitNotTerminatedNamedEntity() : 0;
      }
      // Otherwise, emit a numeric entity if we have one.
      case EntityDecoderState.NumericDecimal: {
        return this.emitNumericEntity(0, 2);
      }
      case EntityDecoderState.NumericHex: {
        return this.emitNumericEntity(0, 3);
      }
      case EntityDecoderState.NumericStart: {
        (_a2 = this.errors) === null || _a2 === void 0 ? void 0 : _a2.absenceOfDigitsInNumericCharacterReference(this.consumed);
        return 0;
      }
      case EntityDecoderState.EntityStart: {
        return 0;
      }
    }
  }
};
function getDecoder(decodeTree) {
  let returnValue = "";
  const decoder = new EntityDecoder(decodeTree, (data) => returnValue += fromCodePoint(data));
  return function decodeWithTrie(input, decodeMode) {
    let lastIndex = 0;
    let offset = 0;
    while ((offset = input.indexOf("&", offset)) >= 0) {
      returnValue += input.slice(lastIndex, offset);
      decoder.startEntity(decodeMode);
      const length = decoder.write(
        input,
        // Skip the "&"
        offset + 1
      );
      if (length < 0) {
        lastIndex = offset + decoder.end();
        break;
      }
      lastIndex = offset + length;
      offset = length === 0 ? lastIndex + 1 : lastIndex;
    }
    const result = returnValue + input.slice(lastIndex);
    returnValue = "";
    return result;
  };
}
function determineBranch(decodeTree, current, nodeIndex, char) {
  const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
  const jumpOffset = current & BinTrieFlags.JUMP_TABLE;
  if (branchCount === 0) {
    return jumpOffset !== 0 && char === jumpOffset ? nodeIndex : -1;
  }
  if (jumpOffset) {
    const value = char - jumpOffset;
    return value < 0 || value >= branchCount ? -1 : decodeTree[nodeIndex + value] - 1;
  }
  let lo = nodeIndex;
  let hi = lo + branchCount - 1;
  while (lo <= hi) {
    const mid = lo + hi >>> 1;
    const midValue = decodeTree[mid];
    if (midValue < char) {
      lo = mid + 1;
    } else if (midValue > char) {
      hi = mid - 1;
    } else {
      return decodeTree[mid + branchCount];
    }
  }
  return -1;
}
var htmlDecoder = /* @__PURE__ */ getDecoder(htmlDecodeTree);
function decodeHTML(htmlString, mode = DecodingMode.Legacy) {
  return htmlDecoder(htmlString, mode);
}

// node_modules/entities/dist/esm/escape.js
var getCodePoint = (
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  String.prototype.codePointAt == null ? (c, index) => (c.charCodeAt(index) & 64512) === 55296 ? (c.charCodeAt(index) - 55296) * 1024 + c.charCodeAt(index + 1) - 56320 + 65536 : c.charCodeAt(index) : (
    // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
    (input, index) => input.codePointAt(index)
  )
);

// node_modules/entities/dist/esm/index.js
var EntityLevel;
(function(EntityLevel2) {
  EntityLevel2[EntityLevel2["XML"] = 0] = "XML";
  EntityLevel2[EntityLevel2["HTML"] = 1] = "HTML";
})(EntityLevel || (EntityLevel = {}));
var EncodingMode;
(function(EncodingMode2) {
  EncodingMode2[EncodingMode2["UTF8"] = 0] = "UTF8";
  EncodingMode2[EncodingMode2["ASCII"] = 1] = "ASCII";
  EncodingMode2[EncodingMode2["Extensive"] = 2] = "Extensive";
  EncodingMode2[EncodingMode2["Attribute"] = 3] = "Attribute";
  EncodingMode2[EncodingMode2["Text"] = 4] = "Text";
})(EncodingMode || (EncodingMode = {}));

// integrations/wizebot/src/catalog.ts
function parseWizeBotCatalog(value) {
  const rows = value?.data;
  if (!Array.isArray(rows) || rows.length > 5e3) throw new Error("Liste WizeBot invalide : les boutons existants sont conserv\xE9s.");
  const ids = /* @__PURE__ */ new Set();
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length < 7 || !row.slice(0, 6).every((v) => typeof v === "string") || !/^\d{1,30}$/.test(row[1]) || ids.has(row[1])) throw new Error("Format de liste WizeBot non reconnu.");
    ids.add(row[1]);
    const plain = (s) => decodeHTML(s.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, ""));
    const aliases = [...new Set(plain(row[0]).split(/[\s,|]+/).filter((v) => /^![\p{L}\p{N}_-]{1,80}$/u.test(v)))];
    const publishedText = plain(row[2]);
    if (publishedText.length > 2e4) throw new Error("R\xE9ponse WizeBot trop longue.");
    return { id: row[1], aliases, publishedText, kind: row[5], cost: row[3], revision: createHash("sha256").update(JSON.stringify(row.slice(0, 7))).digest("hex") };
  });
}

// integrations/streamlabs/src/events.ts
var STREAMLABS_CONTROL_TYPES = /* @__PURE__ */ new Set(["rollendcredits", "sessionreset", "userstatesessionreset"]);
function isStreamlabsActivityType(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,39}$/i.test(value) && !STREAMLABS_CONTROL_TYPES.has(value.toLowerCase().replace(/[-_]/g, ""));
}

// integrations/streamlabs/src/history.ts
var COLLECTION_TYPES = {
  donations: ["donation"],
  subscriptions: ["subscription"],
  follows: ["follow"],
  raids: ["raid"],
  bits: ["bits"]
};
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text(value, max) {
  return typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? String(value).slice(0, max) : "";
}
function name(...values) {
  for (const value of values) {
    const candidate = text(value, 100).trim();
    if (candidate) return candidate;
  }
  return "";
}
function nonnegative(value) {
  if (typeof value !== "number" && typeof value !== "string") return void 0;
  if (typeof value === "string" && !value.trim()) return void 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : void 0;
}
function count(value) {
  const number = nonnegative(value);
  return number !== void 0 && Number.isSafeInteger(number) ? number : void 0;
}
function identity(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return typeof value === "string" && value.length > 0 && value.length <= 6e3 && value.trim() ? value : null;
}
function cloudDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const milliseconds = (fraction ?? "").padEnd(3, "0");
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}Z`;
  const localTime = Date.parse(local);
  if (!Number.isFinite(localTime) || new Date(localTime).toISOString() !== local) return null;
  if (zone && zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  const instant2 = Date.parse(`${local.slice(0, -1)}${zone ?? "Z"}`);
  return Number.isFinite(instant2) ? new Date(instant2).toISOString() : null;
}
function normalizeStreamlabsHistory(payload, now = /* @__PURE__ */ new Date()) {
  const data = record(record(payload)?.data);
  if (!data) return [];
  const events = [];
  const receivedAt = now.toISOString();
  for (const [collection, types] of Object.entries(COLLECTION_TYPES)) {
    const rows = data[collection];
    if (!Array.isArray(rows)) continue;
    for (const value of rows) {
      const row = record(value);
      if (!row || typeof row.type !== "string" || !types.includes(row.type) || !isStreamlabsActivityType(row.type)) continue;
      const type = row.type;
      const platform = row.platform === "twitch_account" ? "twitch" : row.platform === "youtube_account" ? "youtube" : row.platform === "streamlabs" ? "streamlabs" : null;
      if (!platform) continue;
      const occurredAt = cloudDate(row.created_at);
      const eventIdentity = identity(row._id);
      const providerId = identity(row.id);
      if (!eventIdentity && (!providerId || !occurredAt)) continue;
      const cloudIdentity = eventIdentity ?? `cloud:${JSON.stringify([row.platform, type, row.created_at, providerId])}`;
      const subType = text(row.sub_type ?? row.subType, 40);
      const gift = type === "subscription" && /gift/i.test(subType);
      const event = {
        // Match the Socket API's exact _id hash when an actual event _id exists.
        // Otherwise this namespaced composite is stable across repeated imports.
        id: createHash("sha256").update(JSON.stringify([platform, type, cloudIdentity])).digest("hex"),
        platform,
        type,
        displayName: (gift ? name(row.gifter_display_name, row.gifter, row.from_display_name, row.from) : name(row.display_name, row.name, row.from_display_name, row.from)) || "Anonyme",
        message: text(row.message ?? row.comment, 2e3),
        receivedAt,
        occurredAt,
        origin: "cloud",
        test: row.isTest === true || row.is_test === true
      };
      if (type === "donation") {
        const amount = nonnegative(row.amount);
        const currency = typeof row.currency === "string" ? row.currency.trim().toUpperCase() : "";
        const amountLabel = text(row.formatted_amount ?? row.formattedAmount ?? row.displayString, 80);
        if (amount !== void 0) event.amount = amount;
        if (/^[A-Z]{3}$/.test(currency)) event.currency = currency;
        if (amountLabel) event.amountLabel = amountLabel;
      }
      if (type === "bits") {
        const amount = count(row.amount);
        if (amount !== void 0) event.count = amount;
      }
      if (type === "raid") {
        const viewers = count(row.raiders ?? row.viewers);
        if (viewers !== void 0) event.count = viewers;
      }
      if (type === "subscription") {
        const months = count(row.months);
        const gifts = count(row.gifted ?? row.count);
        const recipient = gift ? name(row.recipient, row.recipient_name, row.display_name, row.name) : name(row.recipient, row.recipient_name);
        if (months !== void 0) event.months = months;
        if (gifts !== void 0) event.count = gifts;
        if (subType) event.subType = subType;
        if (recipient) event.recipient = recipient;
      }
      events.push(event);
    }
  }
  return mergeStreamlabsHistory([], events, events.length);
}
function eventTime(event) {
  const occurred = typeof event.occurredAt === "string" ? Date.parse(event.occurredAt) : NaN;
  if (Number.isFinite(occurred)) return occurred;
  if (event.origin === "cloud") return Number.NEGATIVE_INFINITY;
  const received = Date.parse(event.receivedAt);
  return Number.isFinite(received) ? received : Number.NEGATIVE_INFINITY;
}
function key(event) {
  return JSON.stringify([event.platform, event.type, event.id]);
}
function combine(first, second) {
  const preferred = first.origin === "cloud" && second.origin !== "cloud" ? second : first;
  const fallback = preferred === first ? second : first;
  const combined = { ...structuredClone(fallback), ...structuredClone(preferred) };
  if (!Number.isFinite(Date.parse(preferred.occurredAt ?? "")) && Number.isFinite(Date.parse(fallback.occurredAt ?? ""))) {
    combined.occurredAt = fallback.occurredAt;
  }
  if (preferred.origin !== "cloud") delete combined.origin;
  return combined;
}
function mergeStreamlabsHistory(localItems, cloudItems, limit = 1e3) {
  const items = /* @__PURE__ */ new Map();
  for (const source of [localItems, cloudItems]) {
    for (const event of source) {
      if (!event || typeof event.id !== "string" || !event.id || !isStreamlabsActivityType(event.type)) continue;
      const eventKey = key(event);
      const existing = items.get(eventKey);
      items.set(eventKey, existing ? combine(existing, event) : structuredClone(event));
    }
  }
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 1e3;
  return [...items.values()].sort((a, b) => {
    const aTime = eventTime(a), bTime = eventTime(b);
    if (aTime !== bTime) return aTime > bTime ? -1 : 1;
    const aKey = key(a), bKey = key(b);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  }).slice(0, boundedLimit);
}

// packages/core/src/twitch-tags.ts
var TWITCH_TAG_LIMIT = 10;
var TWITCH_TAG_MAX_LENGTH = 25;
function normalizeTwitchTag(value) {
  const tag = value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
  return isValidTwitchTag(tag) ? tag : void 0;
}
function isValidTwitchTag(value) {
  return /^[\p{L}\p{N}]+$/u.test(value) && Array.from(value).length <= TWITCH_TAG_MAX_LENGTH;
}
var rules = [
  ["JustChatting", ["just chatting", "discussion", "discussions", "papotage", "blabla"]],
  ["Speedrun", ["speedrun", "speedrunning"]],
  ["Ranked", ["ranked", "classe", "classee", "classees"]],
  ["Coop", ["coop", "co op", "cooperatif", "cooperative"]],
  ["FirstPlaythrough", ["first playthrough", "first time playing", "premiere partie", "decouverte"]],
  ["Tutorial", ["tutorial", "tutorials", "tutoriel", "tutoriels", "tuto"]],
  ["Challenge", ["challenge", "defi"]],
  ["Creative", ["art", "drawing", "dessin", "painting", "peinture"]],
  ["Music", ["music", "musique", "guitar", "guitare", "piano"]],
  ["Programming", ["software and game development", "programming", "coding", "programmation", "developpement"]],
  ["Cooking", ["food and drink", "food drink", "cooking", "cuisine", "recette"]],
  ["Chill", ["chill", "relax", "detente"]]
];
function words(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
var languages = {
  fr: "French",
  french: "French",
  francais: "French",
  en: "English",
  english: "English",
  anglais: "English",
  espanol: "Spanish",
  es: "Spanish",
  spanish: "Spanish",
  espagnol: "Spanish",
  ru: "Russian",
  russian: "Russian",
  russe: "Russian",
  "\u0440\u0443\u0441\u0441\u043A\u0438\u0438": "Russian",
  deutsch: "German",
  de: "German",
  german: "German",
  allemand: "German",
  italiano: "Italian",
  it: "Italian",
  italian: "Italian",
  italien: "Italian",
  portugues: "Portuguese",
  pt: "Portuguese",
  portuguese: "Portuguese",
  portugais: "Portuguese",
  ja: "Japanese",
  japanese: "Japanese",
  japonais: "Japanese",
  ko: "Korean",
  korean: "Korean",
  coreen: "Korean",
  zh: "Chinese",
  chinese: "Chinese",
  chinois: "Chinese"
};
function normalizeTwitchLanguage(value) {
  const language = words(value);
  const primary = language.split(" ")[0];
  return Object.hasOwn(languages, language) ? languages[language] : Object.hasOwn(languages, primary) ? languages[primary] : void 0;
}
function generateTwitchTags(input = {}) {
  const category = input.category ?? input.twitch?.gameName ?? "";
  const title = input.title ?? input.twitch?.title ?? "";
  const sources = [category, input.game ?? "", title, input.description ?? "", ...input.context ?? []].map((value) => ` ${words(value)} `);
  const language = normalizeTwitchLanguage(input.language ?? input.twitch?.language ?? "");
  const candidates = [category, input.game ?? "", language ?? ""];
  for (const [tag, phrases] of rules) {
    if (sources.some((source) => phrases.some((phrase) => source.includes(` ${phrase} `)))) candidates.push(tag);
  }
  candidates.push(...input.twitch?.tags ?? [], ...input.preferredTags ?? [], ...input.defaultTags ?? []);
  const tags = [];
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    const tag = normalizeTwitchTag(candidate);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === TWITCH_TAG_LIMIT) break;
  }
  return tags.length ? tags : ["Live"];
}
export {
  PlanningOrchestrator,
  createBinaryHash,
  createHash as createIdentityHash,
  defaultProductProfile,
  generateTwitchTags,
  googleRecurrence,
  mergeStreamlabsHistory,
  normalizeStreamlabsHistory,
  parseGoogleRecurrence,
  parseWizeBotCatalog,
  randomUuid,
  validateProductProfile
};
