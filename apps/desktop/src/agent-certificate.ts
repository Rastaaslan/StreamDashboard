import {spawn} from 'node:child_process';
import {randomBytes, X509Certificate} from 'node:crypto';

export interface AgentCertificate {pfx:string;passphrase:string;certificate:string}

// The password travels over stdin, never through process arguments or logs.
// .NET creates the certificate and private key in memory; no root is installed.
const generateScript=String.raw`
$ErrorActionPreference='Stop'
$inputValue=[Console]::In.ReadToEnd() | ConvertFrom-Json
$certificate=$null
$rsa=[Security.Cryptography.RSACng]::new(2048)
try {
 $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new(('CN=StreamDashboard-'+[guid]::NewGuid().ToString('N')),$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
 $usage=[Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature,$true)
 $request.CertificateExtensions.Add($usage)
 $oids=[Security.Cryptography.OidCollection]::new()
 [void]$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
 $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$true))
 $certificate=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddYears(2))
 $result=@{pfx=[Convert]::ToBase64String($certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,[string]$inputValue.passphrase));certificate=[Convert]::ToBase64String($certificate.RawData)} | ConvertTo-Json -Compress
} finally {
 if($certificate){$certificate.Dispose()}
 $rsa.Dispose()
}
[Console]::Out.Write($result)
`;

export function certificateFingerprint(pem:string,now=Date.now()) {
 const certificate=new X509Certificate(pem);
 if(Date.parse(certificate.validFrom)>now||Date.parse(certificate.validTo)<=now)throw new Error('Certificat de l’agent expiré ou pas encore valide. Renouvelez son association.');
 return certificate.fingerprint256.replaceAll(':','').toLowerCase();
}

export async function createAgentCertificate(platform=process.platform):Promise<AgentCertificate> {
 if(platform!=='win32')throw new Error('La création du certificat de cet agent nécessite Windows.');
 const passphrase=randomBytes(32).toString('base64url');
 const raw=await new Promise<string>((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(generateScript,'utf16le').toString('base64')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let output='';
  const timeout=setTimeout(()=>{child.kill();reject(new Error('Création du certificat interrompue.'));},30_000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',(chunk:string)=>{output+=chunk;if(output.length>65536){child.kill();reject(new Error('Réponse de certificat invalide.'));}});
  child.stderr.resume();
  child.on('error',()=>{clearTimeout(timeout);reject(new Error('Le moteur de certificats Windows est indisponible.'));});
  child.on('exit',code=>{clearTimeout(timeout);if(code===0)resolve(output);else reject(new Error('Windows n’a pas pu préparer le certificat de l’agent.'));});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({passphrase}));
 });
 let value:{pfx:string;certificate:string};
 try{value=JSON.parse(raw) as typeof value;}catch{throw new Error('Réponse de certificat Windows illisible.');}
 if(typeof value.pfx!=='string'||typeof value.certificate!=='string'||!value.pfx.length)throw new Error('Certificat Windows invalide.');
 const certificate=new X509Certificate(Buffer.from(value.certificate,'base64')).toString();
 certificateFingerprint(certificate);
 return {pfx:value.pfx,certificate,passphrase};
}
