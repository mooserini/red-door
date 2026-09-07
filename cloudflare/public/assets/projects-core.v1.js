(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  root.ResonantProjects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  function cleanString(value){
    return typeof value === 'string' ? value.trim() : '';
  }

  function isPrivateHostname(hostname){
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if(host === 'localhost' ||
       host.endsWith('.local') ||
       host.endsWith('.internal') ||
       host.endsWith('.lan') ||
       host.endsWith('.home') ||
       host.endsWith('.ts.net')) return true;

    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if(ipv4){
      const octets = ipv4.slice(1).map(Number);
      if(octets.some(value => value > 255)) return true;
      const [a, b] = octets;
      return a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || a >= 224;
    }

    if(!host.includes(':')) return false;
    return host === '::1' || host.startsWith('fc') ||
      host.startsWith('fd') || host.startsWith('fe80:');
  }

  function hasSensitiveQuery(parsed){
    const sensitive = /^(?:access_?token|api_?key|auth|authorization|password|secret|signature|sig|token)$/i;
    for(const key of parsed.searchParams.keys()){
      if(sensitive.test(key)) return true;
    }
    return false;
  }

  function safeHttpUrl(value){
    const text = cleanString(value);
    if(!text || /[\u0000-\u001f\u007f-\u009f]/.test(text)) return '';
    try{
      const parsed = new URL(text);
      if(parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
      if(parsed.username || parsed.password || parsed.port) return '';
      if(isPrivateHostname(parsed.hostname) || hasSensitiveQuery(parsed)) return '';
      return text;
    }catch(_error){
      return '';
    }
  }

  function parseWorkItem(item){
    if(!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const name = cleanString(item.name);
    const blurb = cleanString(item.blurb);
    const status = cleanString(item.status);
    if(!name || !blurb || !status) return null;
    return { name, blurb, status, url:safeHttpUrl(item.url) };
  }

  function parseLink(item){
    if(!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const label = cleanString(item.label);
    const url = safeHttpUrl(item.url);
    return label && url ? { label, url } : null;
  }

  function parseProjectManifest(value){
    if(!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if(value.schemaVersion !== 1 || !Array.isArray(value.work)) return null;
    const work = value.work.map(parseWorkItem).filter(Boolean);
    const links = Array.isArray(value.links) ? value.links.map(parseLink).filter(Boolean) : [];
    return {
      schemaVersion:1,
      owner:cleanString(value.owner),
      updated:cleanString(value.updated),
      work,
      links
    };
  }

  function projectLines(manifest, fallbackLines){
    const fallback = Array.isArray(fallbackLines) ? fallbackLines.slice() : [];
    if(!manifest || !Array.isArray(manifest.work) || !manifest.work.length) return fallback;
    const lines = ['CURRENT THREADS'];
    manifest.work.forEach(function(item){
      lines.push('  [' + item.status + '] ' + item.name);
      lines.push('    ' + item.blurb);
      if(item.url) lines.push('    ' + item.url);
    });
    if(Array.isArray(manifest.links) && manifest.links.length){
      lines.push('');
      lines.push('LINKS');
      manifest.links.forEach(function(item){
        lines.push('  ' + item.label);
        lines.push('    ' + item.url);
      });
    }
    return lines;
  }

  return { parseProjectManifest, projectLines };
});
