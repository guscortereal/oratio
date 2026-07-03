// Oratio — carrega e renderiza a centelha do dia (ou de um dia do arquivo).
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  function formatDatePt(iso) {
    // iso = "AAAA-MM-DD"
    const [y, m, d] = (iso || '').split('-').map(Number);
    if (!y) return '';
    const date = new Date(y, m - 1, d);
    const s = date.toLocaleDateString('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function renderParagraphs(container, text) {
    container.innerHTML = '';
    (text || '').split(/\n\s*\n/).forEach((para) => {
      const p = document.createElement('p');
      p.textContent = para.trim();
      if (p.textContent) container.appendChild(p);
    });
  }

  function renderImageCredit(image) {
    const hero = $('hero');
    if (!image || !image.src) { hide(hero); return; }
    const img = $('hero-img');
    img.src = image.src;
    img.alt = image.title || 'Arte sacra relacionada ao Evangelho do dia';

    const cleanTitle = (image.title || '').replace(/\.(jpe?g|png|gif|tiff?|webp)$/i, '');
    const parts = [];
    if (cleanTitle) parts.push(cleanTitle);
    if (image.artist && image.artist !== 'Autor desconhecido') parts.push(image.artist);
    let credit = parts.join(' — ');
    if (image.license) credit += ` · ${image.license}`;

    const cap = $('hero-credit');
    cap.innerHTML = '';
    const label = document.createTextNode('Imagem: ');
    cap.appendChild(label);
    if (image.descriptionUrl) {
      const a = document.createElement('a');
      a.href = image.descriptionUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = credit;
      cap.appendChild(a);
    } else {
      cap.appendChild(document.createTextNode(credit));
    }
    cap.appendChild(document.createTextNode(' (Wikimedia Commons)'));
    show(hero);
  }

  function render(rec) {
    const r = rec.reflexao || {};
    $('liturgia').textContent = rec.liturgia || '';
    $('data').textContent = formatDatePt(rec.date);
    $('titulo').textContent = r.tituloBreve || '';
    $('referencia').textContent = (rec.evangelho && rec.evangelho.referencia) || '';
    renderParagraphs($('corpo'), r.corpo);
    $('silencio').textContent = ' ' + (r.paraSilencio || '');
    $('proposito').textContent = ' ' + (r.proposito || '');

    if (r.ancora) { $('ancora').textContent = r.ancora; show($('ancora')); }
    else hide($('ancora'));

    if (rec.evangelho && rec.evangelho.texto) {
      $('gospel-ref').textContent = rec.evangelho.referencia || '';
      $('gospel-text').textContent = rec.evangelho.texto;
    }

    renderImageCredit(rec.image);

    document.title = (r.tituloBreve ? r.tituloBreve + ' — ' : '') + 'Oratio';
    hide($('loading'));
    show($('reflection'));
  }

  async function loadArchive(currentDate) {
    try {
      const res = await fetch('reflections/index.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const index = await res.json();
      if (!Array.isArray(index) || index.length <= 1) return;
      const list = $('archive-list');
      list.innerHTML = '';
      index
        .filter((e) => e.date !== currentDate)
        .slice(0, 30)
        .forEach((e) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = '?date=' + encodeURIComponent(e.date);
          const dateSpan = document.createElement('span');
          dateSpan.className = 'a-date';
          dateSpan.textContent = e.date;
          a.appendChild(dateSpan);
          a.appendChild(document.createTextNode(
            (e.titulo ? e.titulo : e.referencia) + (e.titulo ? ` (${e.referencia})` : '')
          ));
          li.appendChild(a);
          list.appendChild(li);
        });
      if (list.children.length) show($('archive'));
    } catch (_) { /* arquivo é opcional */ }
  }

  async function main() {
    const params = new URLSearchParams(location.search);
    const date = params.get('date');
    const src = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? `reflections/${date}.json`
      : 'reflections/latest.json';
    try {
      const res = await fetch(src, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const rec = await res.json();
      render(rec);
      loadArchive(rec.date);
    } catch (err) {
      hide($('loading'));
      show($('error'));
    }
  }

  main();
})();
