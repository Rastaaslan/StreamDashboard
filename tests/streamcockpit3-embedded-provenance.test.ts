import {describe,it,expect} from 'vitest';
// @ts-expect-error Standalone executable JS verifier has no declaration file.
import {assertSameEmbeddedCommit} from '../scripts/streamcockpit3-embedded-provenance.mjs';

const commit='a'.repeat(40);
const record=()=>({schemaVersion:1,product:'Le StreamCockpit',
  version:'3.0.0-alpha.1',sourceCommit:commit,
  sourceTreeSha256:'b'.repeat(64),sourceTreeDirty:false});
describe('G4: embedded Windows and Android build provenance must agree',()=>{
  it('accepts only matching clean source commit and source tree from both archives',()=>{
    expect(assertSameEmbeddedCommit(commit,record(),record())).toEqual({
      sourceCommit:commit,sourceTreeSha256:'b'.repeat(64)});
  });
  it('rejects mismatched commit even if manifest identifies the expected source',()=>{
    expect(()=>assertSameEmbeddedCommit(commit,record(),{
      ...record(),sourceCommit:'c'.repeat(40)})).toThrow('SC3_ARTIFACT_EMBEDDED_COMMIT_MISMATCH');
  });
  it('rejects independently dirty or mismatched trees',()=>{
    expect(()=>assertSameEmbeddedCommit(commit,{...record(),sourceTreeDirty:true},record()))
      .toThrow('SC3_ARTIFACT_EMBEDDED_PROVENANCE_INVALID');
    expect(()=>assertSameEmbeddedCommit(commit,record(),{
      ...record(),sourceTreeSha256:'d'.repeat(64)}))
      .toThrow('SC3_ARTIFACT_EMBEDDED_ARTIFACT_MISMATCH');
  });
  it('rejects missing or extra metadata and a different version',()=>{
    expect(()=>assertSameEmbeddedCommit(commit,{...record(),extra:'untrusted'},record()))
      .toThrow('SC3_ARTIFACT_EMBEDDED_PROVENANCE_INVALID');
    expect(()=>assertSameEmbeddedCommit(commit,record(),{
      ...record(),version:'3.0.2'}))
      .toThrow('SC3_ARTIFACT_EMBEDDED_ARTIFACT_MISMATCH');
    expect(()=>assertSameEmbeddedCommit(commit,record(),{
      ...record(),product:'Other'}))
      .toThrow('SC3_ARTIFACT_EMBEDDED_PROVENANCE_INVALID');
  });
});
