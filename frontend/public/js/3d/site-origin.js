// Reescreve as URLs do CDN antigo (silrev.biz) para a origem atual do site.
// Carregar DEPOIS do three.js e ANTES do editor de avatar.
(function () {
  if (typeof THREE === 'undefined') {
    console.error('[site-origin] THREE nao esta carregado');
    return;
  }
  THREE.DefaultLoadingManager.setURLModifier(function (url) {
    if (typeof url !== 'string') return url;
    var out = url.replace(/^https?:\/\/(www\.)?silrev\.biz/i, '');
    if (out !== url) out = out.replace(/^\/+/, '/');
    return out;
  });
})();
