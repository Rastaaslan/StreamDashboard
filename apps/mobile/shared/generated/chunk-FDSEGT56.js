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
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.test(key)) throw new Error(`Le profil ne peut pas contenir de secret (${at}.${key}).`);
    assertSecretFree(child, `${at}.${key}`);
  }
}
var plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function validateProductProfile(value) {
  if (!plainObject(value)) throw new Error("Profil invalide.");
  if (value.version !== 1) throw new Error(`Version de profil non prise en charge: ${String(value.version)}.`);
  assertSecretFree(value);
  const result = structuredClone(defaultProductProfile());
  for (const key of ["profile", "modules", "appearance", "mobile", "providers", "onboarding", "obs"]) if (plainObject(value[key])) Object.assign(result[key], value[key]);
  for (const id of Object.keys(result.modules)) if (typeof result.modules[id] !== "boolean") throw new Error(`Module invalide: ${id}.`);
  if (!/^#[0-9a-f]{6}$/i.test(result.appearance.accent)) throw new Error("La couleur principale doit utiliser le format #RRGGBB.");
  if (!["system", "light", "dark", "oled"].includes(result.appearance.theme)) throw new Error("Th\xE8me invalide.");
  const dependencies = { soundboard: ["obs"], streamerPings: ["twitch"], googleCalendar: ["planning"] };
  for (const [id, required] of Object.entries(dependencies)) if (result.modules[id]) {
    for (const dependency of required) if (!result.modules[dependency]) throw new Error(`${id} n\xE9cessite le module ${dependency}.`);
  }
  return result;
}

export {
  defaultProductProfile,
  validateProductProfile
};
