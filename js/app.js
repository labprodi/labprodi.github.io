(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const SUMBER_DATA = "data/katalog.json";
  const SUMBER_TERENKRIPSI = "data/katalog.enc";

  // Versi publik (hasil skrip/bangun.js) menandai <html data-terenkripsi>: data dan foto terenkripsi,
  // dan kuncinya dibaca dari bagian #k=... pada alamat. Versi sumber memuat data/katalog.json apa adanya.
  const TERENKRIPSI = document.documentElement.hasAttribute("data-terenkripsi");
  const PIKSEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  let KUNCI = null;
  let KUNCI_TEKS = "";
  let TIPE = {}; // jenis berkas (MIME) tiap foto terenkripsi

  const parameter = () => new URLSearchParams(location.hash.slice(1));

  // Menyusun bagian # pada alamat: kunci (jika ada) selalu ikut supaya tautan tetap bisa dibagikan.
  function hashDengan(idAlat) {
    const p = new URLSearchParams();
    if (KUNCI_TEKS) p.set("k", KUNCI_TEKS);
    if (idAlat) p.set("alat", idAlat);
    const teks = p.toString();
    return teks ? "#" + teks : "";
  }

  async function imporKunci(teks) {
    const biner = atob(teks.replace(/-/g, "+").replace(/_/g, "/"));
    const byte = Uint8Array.from(biner, (c) => c.charCodeAt(0));
    if (byte.length !== 32) throw new Error("Panjang kunci salah");
    return crypto.subtle.importKey("raw", byte, "AES-GCM", false, ["decrypt"]);
  }

  // Format berkas terenkripsi: 12 byte IV, lalu ciphertext AES-256-GCM beserta tag-nya.
  function dekripsi(buf) {
    const d = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: d.subarray(0, 12) }, KUNCI, d.subarray(12));
  }

  const fotoTerenkripsi = (p) => TERENKRIPSI && /\.bin$/.test(p);
  const atrFoto = (p) => (fotoTerenkripsi(p) ? `src="${PIKSEL}" data-foto="${esc(p)}"` : `src="${esc(p)}"`);

  const cacheFoto = new Map();
  function urlFoto(p) {
    if (!fotoTerenkripsi(p)) return Promise.resolve(p);
    if (!cacheFoto.has(p)) {
      cacheFoto.set(
        p,
        fetch(p)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then(dekripsi)
          .then((buf) => URL.createObjectURL(new Blob([buf], { type: TIPE[p] || "" })))
      );
    }
    return cacheFoto.get(p);
  }

  function isiFoto(img) {
    const p = img.dataset.foto;
    urlFoto(p)
      .then((u) => { if (img.dataset.foto === p) img.src = u; })
      .catch(() => { img.src = FOTO_BAWAAN; });
  }

  // Foto terenkripsi baru didekripsi saat mendekati layar.
  const pengamat = "IntersectionObserver" in window
    ? new IntersectionObserver((entri) => entri.forEach((e) => {
        if (!e.isIntersecting) return;
        pengamat.unobserve(e.target);
        isiFoto(e.target);
      }), { rootMargin: "300px" })
    : null;

  function muatFoto(akar, langsung) {
    akar.querySelectorAll("img[data-foto]").forEach((img) => (pengamat && !langsung ? pengamat.observe(img) : isiFoto(img)));
  }

  // Label kondisi terikat dengan warna di css/style.css, jadi tetap di sini (bukan di JSON).
  const STATUS = { baik: "Baik", sebagian: "Sebagian rusak", rusak: "Rusak", labil: "Tidak stabil", belum: "Belum diuji" };
  const URUTAN_STATUS = ["baik", "sebagian", "labil", "belum", "rusak"];

  // Diisi dari data/katalog.json saat halaman dimuat.
  let ALAT = [];
  let KATEGORI = {};
  let LAB = {};
  let FOTO_BAWAAN = "img/tanpa-foto.svg";
  let BAWAAN = {};

  // Melengkapi tiap alat dengan nilai turunan (nomor, jumlah, status) supaya tidak perlu ditulis di JSON.
  function siapkan(data) {
    KATEGORI = data.kategori || {};
    LAB = data.lab || {};
    BAWAAN = data.bawaan || {};
    FOTO_BAWAAN = BAWAAN.gambar || FOTO_BAWAAN;
    ALAT = (data.alat || []).map((mentah, i) => {
      const a = Object.assign({}, mentah);
      a.no = i + 1;
      a.unit = a.unit || {};
      a.gambar = [].concat(a.gambar || []);
      a.tanpaFoto = a.gambar.length === 0;
      if (a.tanpaFoto) a.gambar = [FOTO_BAWAAN];
      a.fungsi = a.fungsi || "";
      a.satuan = a.satuan || "unit";
      a.jumlah = Object.values(a.unit).reduce((n, x) => n + x, 0);
      a.lengkap = typeof a.sistemLengkap === "boolean" ? a.sistemLengkap : null; // null = tidak tercatat
      a.sistem = a.lengkap === null ? "Tidak tercatat" : a.lengkap ? "Lengkap" : "Tidak lengkap";
      if (!STATUS[a.status]) {
        const jenis = Object.keys(a.unit).filter((k) => a.unit[k] > 0);
        a.status = jenis.length === 1 && STATUS[jenis[0]] ? jenis[0] : "sebagian";
      }
      if (!KATEGORI[a.kategori]) {
        console.warn(`Kategori "${a.kategori}" pada alat "${a.id}" belum terdaftar di bagian "kategori".`);
        KATEGORI[a.kategori] = a.kategori;
      }
      if (a.lab && !LAB[a.lab]) {
        console.warn(`Lab "${a.lab}" pada alat "${a.id}" belum terdaftar di bagian "lab".`);
        LAB[a.lab] = a.lab;
      }
      a.labNama = a.lab ? LAB[a.lab] : "";
      return a;
    });
  }

  const JUDUL = document.title;

  const state = { q: "", lab: "semua", kategori: "semua", status: "semua", urut: "katalog", tampilan: "kartu" };
  let tampil = []; // daftar setelah filter, dipakai navigasi sebelumnya/berikutnya
  let aktif = null;

  try {
    const t = localStorage.getItem("tampilan");
    if (t === "kartu" || t === "tabel") state.tampilan = t;
  } catch (e) {}

  const tahunTeks = (a) => (a.tahun ? String(a.tahun) : "Tidak tercatat");
  const labKat = (a) => [a.labNama, KATEGORI[a.kategori]].filter(Boolean).join(" · ");
  const badge = (a) => `<span class="badge" data-status="${a.status}">${esc(STATUS[a.status])}</span>`;

  /* ---------- Ringkasan ---------- */
  function ringkasan() {
    const total = ALAT.reduce((n, a) => n + a.jumlah, 0);
    const unit = {};
    ALAT.forEach((a) => {
      for (const k in a.unit) unit[k] = (unit[k] || 0) + a.unit[k];
    });
    const tidakLengkap = ALAT.filter((a) => a.lengkap === false).length;

    const stat = [
      [ALAT.length, "jenis peralatan"],
      [total, "total unit"],
      [unit.baik || 0, "unit kondisi baik"],
      [tidakLengkap, "jenis dengan sistem tidak lengkap"],
    ];
    $("stats").innerHTML = stat.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("");

    const label = { baik: "Baik", rusak: "Rusak", labil: "Tidak stabil", belum: "Belum diuji" };
    const urut = ["baik", "labil", "belum", "rusak"].filter((k) => unit[k]);
    $("kondisiTotal").textContent = `${total} unit`;
    $("bar").innerHTML = urut.map((k) => `<i data-status="${k}" style="flex-grow:${unit[k]}" title="${label[k]}: ${unit[k]} unit"></i>`).join("");
    $("bar").setAttribute("aria-label", urut.map((k) => `${label[k]} ${unit[k]} unit`).join(", "));
    $("legend").innerHTML = urut
      .map((k) => `<li data-status="${k}"><span class="dot"></span>${label[k]} <b>${unit[k]}</b> <span>(${Math.round((unit[k] / total) * 100)}%)</span></li>`)
      .join("");
  }

  /* ---------- Chip filter ---------- */
  function chips() {
    const hitung = (kunci) => ALAT.reduce((o, a) => ((o[a[kunci]] = (o[a[kunci]] || 0) + 1), o), {});
    const perLab = hitung("lab");
    const perKat = hitung("kategori");
    const perStatus = hitung("status");

    $("chipLab").innerHTML =
      `<button class="chip" type="button" data-nilai="semua">Semua <small>${ALAT.length}</small></button>` +
      Object.keys(LAB)
        .map((k) => `<button class="chip" type="button" data-nilai="${esc(k)}"${perLab[k] ? "" : " data-kosong"}>${esc(LAB[k])} <small>${perLab[k] || 0}</small></button>`)
        .join("");

    $("chipKategori").innerHTML =
      `<button class="chip" type="button" data-nilai="semua">Semua <small>${ALAT.length}</small></button>` +
      Object.keys(KATEGORI)
        .map((k) => `<button class="chip" type="button" data-nilai="${k}">${esc(KATEGORI[k])} <small>${perKat[k] || 0}</small></button>`)
        .join("");

    $("chipStatus").innerHTML =
      `<button class="chip" type="button" data-nilai="semua">Semua</button>` +
      URUTAN_STATUS.filter((s) => perStatus[s])
        .map((s) => `<button class="chip" type="button" data-nilai="${s}" data-status="${s}"><span class="dot"></span>${esc(STATUS[s])} <small>${perStatus[s]}</small></button>`)
        .join("");

    const pasang = (el, kunci) =>
      el.addEventListener("click", (e) => {
        const b = e.target.closest(".chip");
        if (!b) return;
        state[kunci] = b.dataset.nilai;
        render();
      });
    pasang($("chipLab"), "lab");
    pasang($("chipKategori"), "kategori");
    pasang($("chipStatus"), "status");
  }

  /* ---------- Daftar ---------- */
  function saring() {
    const q = state.q.trim().toLowerCase();
    const hasil = ALAT.filter((a) => {
      if (state.lab !== "semua" && a.lab !== state.lab) return false;
      if (state.kategori !== "semua" && a.kategori !== state.kategori) return false;
      if (state.status !== "semua" && a.status !== state.status) return false;
      if (!q) return true;
      const teks = [a.nama, a.labNama, a.kode, a.spesifikasi, a.fungsi, KATEGORI[a.kategori], STATUS[a.status], a.kondisi, a.catatan, a.sistemCatatan, (a.fitur || []).map((f) => `${f.judul} ${f.keterangan}`).join(" ")]
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((kata) => teks.includes(kata));
    });

    const urut = {
      katalog: (a, b) => a.no - b.no,
      nama: (a, b) => a.nama.localeCompare(b.nama, "id"),
      jumlah: (a, b) => b.jumlah - a.jumlah || a.no - b.no,
      tahun: (a, b) => (b.tahun || 0) - (a.tahun || 0) || a.no - b.no,
    };
    return hasil.sort(urut[state.urut]);
  }

  function ringkas(a) {
    return a.fungsi || (a.fitur || []).map((f) => f.judul).join(", ");
  }

  function render() {
    tampil = saring();

    document.querySelectorAll("#chipLab .chip").forEach((b) => b.setAttribute("aria-pressed", b.dataset.nilai === state.lab));
    document.querySelectorAll("#chipKategori .chip").forEach((b) => b.setAttribute("aria-pressed", b.dataset.nilai === state.kategori));
    document.querySelectorAll("#chipStatus .chip").forEach((b) => b.setAttribute("aria-pressed", b.dataset.nilai === state.status));
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tampilan === state.tampilan));

    const unit = tampil.reduce((n, a) => n + a.jumlah, 0);
    $("hasil").textContent =
      tampil.length === ALAT.length
        ? `Menampilkan semua ${ALAT.length} jenis peralatan (${unit} unit).`
        : `Menampilkan ${tampil.length} dari ${ALAT.length} jenis peralatan (${unit} unit).`;

    const kosong = tampil.length === 0;
    $("kosong").hidden = !kosong;
    $("grid").hidden = kosong || state.tampilan !== "kartu";
    $("tabelwrap").hidden = kosong || state.tampilan !== "tabel";

    $("grid").innerHTML = tampil
      .map(
        (a, i) => `
      <button class="kartu" type="button" data-id="${a.id}" style="animation-delay:${Math.min(i, 12) * 25}ms">
        <span class="kartu__foto">
          <img ${atrFoto(a.gambar[0])} alt="Foto ${esc(a.nama)}" loading="lazy">
          ${badge(a)}
        </span>
        <span class="kartu__isi">
          <span class="kartu__kat">${esc(labKat(a))}</span>
          <span class="kartu__nama">${esc(a.nama)}</span>
          <span class="kartu__fungsi">${esc(ringkas(a))}</span>
          <span class="kartu__meta">
            <span><b>${a.jumlah}</b> ${esc(a.satuan)}</span>
            <span>Tahun <b>${a.tahun || "–"}</b></span>
            ${a.lengkap === null ? "" : `<span>Sistem <b>${a.lengkap ? "lengkap" : "tidak lengkap"}</b></span>`}
          </span>
        </span>
      </button>`
      )
      .join("");
    muatFoto($("grid"));

    $("tbody").innerHTML = tampil
      .map(
        (a) => `
      <tr data-id="${a.id}" tabindex="0">
        <td class="redup">${a.no}</td>
        <td class="nama">${esc(a.nama)}</td>
        <td class="rapat">${esc(a.labNama || "–")}</td>
        <td>${esc(KATEGORI[a.kategori])}</td>
        <td class="${a.tahun ? "" : "redup"}">${tahunTeks(a)}</td>
        <td class="num">${a.jumlah} ${esc(a.satuan)}</td>
        <td class="${a.lengkap ? "" : "redup"}">${esc(a.sistem)}</td>
        <td>${badge(a)}</td>
      </tr>`
      )
      .join("");
  }

  /* ---------- Detail ---------- */
  const dlg = $("detail");

  function isiDetail(a) {
    const galeri = a.tanpaFoto
      ? `<div class="galeri"><div class="galeri__utama"><img src="${esc(a.gambar[0])}" alt="Foto belum tersedia"></div></div>`
      : `
      <div class="galeri">
        <a class="galeri__utama" id="gUtama" target="_blank" rel="noopener" title="Buka foto ukuran penuh">
          <img src="${PIKSEL}" alt="Foto ${esc(a.nama)}">
        </a>
        ${
          a.gambar.length > 1
            ? `<div class="galeri__thumb">${a.gambar
                .map((g, i) => `<button type="button" data-src="${esc(g)}" aria-pressed="${i === 0}" aria-label="Foto ${i + 1}"><img ${atrFoto(g)} alt=""></button>`)
                .join("")}</div>`
            : ""
        }
        <small>Klik foto untuk membuka ukuran penuh</small>
      </div>`;

    const fungsi = a.fitur && a.fitur.length
      ? `<ul class="fitur">${a.fitur.map((f) => `<li><b>${esc(f.judul)}</b><span>${esc(f.keterangan)}</span></li>`).join("")}</ul>`
      : `<p>${esc(a.fungsi)}</p>`;

    const spek = [
      ["Lab", a.labNama || "–"],
      ["Kategori", KATEGORI[a.kategori]],
      ["Tahun pengadaan", tahunTeks(a)],
      ["Jumlah", `${a.jumlah} ${a.satuan}`],
      ["Sistem peralatan", a.sistem, a.sistemCatatan],
      ["Lisensi", a.lisensi || "Tidak tercatat"],
      a.kode && ["Kode inventaris", a.kode, null, true],
      a.spesifikasi && ["Spesifikasi", a.spesifikasi, null, true],
      ["Harga pembelian", a.harga || BAWAAN.harga || "–", null, true],
      ["Unit kerja penanggung jawab", a.penanggungJawab || BAWAAN.penanggungJawab || "–", null, true],
    ].filter(Boolean);

    return `
      ${galeri}
      <div class="info" data-status="${a.status}">
        <span class="info__kat">${esc(labKat(a))}</span>
        <h2 id="dNama">${esc(a.nama)}</h2>
        ${badge(a)}

        <h3>Fungsi</h3>
        ${fungsi}

        <h3>Kondisi</h3>
        <p>${esc(a.kondisi)}</p>
        ${a.catatan ? `<p class="catatan"><b>Catatan:</b> ${esc(a.catatan)}</p>` : ""}

        <h3>Rincian</h3>
        <dl class="spek">
          ${spek
            .map(([dt, dd, ket, lebar]) => `<div class="${lebar ? "lebar" : ""}"><dt>${dt}</dt><dd>${esc(dd)}${ket ? `<small>${esc(ket)}</small>` : ""}</dd></div>`)
            .join("")}
        </dl>
      </div>`;
  }

  // Memasang foto utama di jendela detail (didekripsi dulu pada versi terenkripsi).
  function aturUtama(p) {
    const utama = $("gUtama");
    if (!utama) return;
    utama.dataset.foto = p;
    urlFoto(p)
      .then((u) => {
        if (utama.dataset.foto !== p) return;
        utama.href = u;
        utama.querySelector("img").src = u;
      })
      .catch(() => { utama.querySelector("img").src = FOTO_BAWAAN; });
  }

  function buka(id) {
    const a = ALAT.find((x) => x.id === id);
    if (!a) return tutup();
    aktif = a;
    if (!tampil.includes(a)) tampil = ALAT.slice();
    const i = tampil.indexOf(a);

    $("dBody").innerHTML = isiDetail(a);
    if (!a.tanpaFoto) aturUtama(a.gambar[0]);
    muatFoto($("dBody"), true);
    $("dBody").scrollTop = 0;
    $("dPos").textContent = `${i + 1} dari ${tampil.length}`;
    $("dPrev").disabled = i <= 0;
    $("dNext").disabled = i >= tampil.length - 1;
    document.title = `${a.nama} · ${JUDUL}`;
    if (!dlg.open) dlg.showModal();
  }

  function tutup() {
    aktif = null;
    document.title = JUDUL;
    if (dlg.open) dlg.close();
  }

  // Alamat #alat=<id> membuat tiap alat bisa dibagikan lewat tautan dan tombol Back menutup detail.
  function dariHash() {
    const id = parameter().get("alat");
    if (id) buka(id);
    else tutup();
  }

  function pergi(id) {
    location.hash = hashDengan(id);
  }

  function lepasHash() {
    if (parameter().has("alat")) history.pushState(null, "", location.pathname + location.search + hashDengan(null));
    tutup();
  }

  function geser(d) {
    if (!aktif) return;
    const t = tampil[tampil.indexOf(aktif) + d];
    if (t) history.replaceState(null, "", hashDengan(t.id)), buka(t.id);
  }

  /* ---------- Event ---------- */
  function pasangEvent() {
    $("cari").addEventListener("input", (e) => { state.q = e.target.value; render(); });
    $("urut").addEventListener("change", (e) => { state.urut = e.target.value; render(); });

    document.querySelector(".seg").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.tampilan = b.dataset.tampilan;
      try { localStorage.setItem("tampilan", state.tampilan); } catch (err) {}
      render();
    });

    $("btnReset").addEventListener("click", () => {
      state.q = ""; state.lab = "semua"; state.kategori = "semua"; state.status = "semua";
      $("cari").value = "";
      render();
    });

    $("grid").addEventListener("click", (e) => {
      const k = e.target.closest(".kartu");
      if (k) pergi(k.dataset.id);
    });
    $("tbody").addEventListener("click", (e) => {
      const r = e.target.closest("tr");
      if (r) pergi(r.dataset.id);
    });
    $("tbody").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const r = e.target.closest("tr");
      if (r) { e.preventDefault(); pergi(r.dataset.id); }
    });

    $("dTutup").addEventListener("click", lepasHash);
    $("dPrev").addEventListener("click", () => geser(-1));
    $("dNext").addEventListener("click", () => geser(1));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); lepasHash(); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) lepasHash(); });
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") geser(-1);
      if (e.key === "ArrowRight") geser(1);
    });
    $("dBody").addEventListener("click", (e) => {
      const b = e.target.closest(".galeri__thumb button");
      if (!b) return;
      aturUtama(b.dataset.src);
      b.parentNode.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    });

    window.addEventListener("hashchange", dariHash);

    // Foto yang gagal dimuat (path salah/file hilang) diganti gambar bawaan.
    document.addEventListener("error", (e) => {
      const img = e.target;
      if (img.tagName !== "IMG" || img.dataset.gagal) return;
      img.dataset.gagal = "1";
      img.src = FOTO_BAWAAN;
    }, true);

    $("btnTema").addEventListener("click", () => {
      const t = document.documentElement.dataset.tema === "gelap" ? "terang" : "gelap";
      document.documentElement.dataset.tema = t;
      try { localStorage.setItem("tema", t); } catch (err) {}
    });

    const keAtas = $("keAtas");
    window.addEventListener("scroll", () => { keAtas.hidden = window.scrollY < 600; }, { passive: true });
    keAtas.addEventListener("click", () => window.scrollTo({ top: 0 }));

    // Tekan "/" untuk langsung mencari.
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !dlg.open && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        $("cari").focus();
      }
    });
  }

  // Tautan menu (#ringkasan, #katalog) digulir manual supaya kunci di alamat tidak terhapus.
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    const tujuan = a && document.getElementById(a.getAttribute("href").slice(1));
    if (!tujuan) return;
    e.preventDefault();
    tujuan.scrollIntoView();
  });

  function tanpaData(html) {
    document.body.classList.add("tanpa-data");
    $("kosong").hidden = false;
    $("kosong").innerHTML = html;
  }

  function terkunci(salah) {
    tanpaData(
      salah
        ? `<p><b>Tautan tidak valid.</b></p><p>Kunci pada tautan ini salah atau sudah tidak berlaku. Mintalah tautan terbaru kepada pengelola lab.</p>`
        : `<p><b>Katalog ini bersifat terbatas.</b></p><p>Buka halaman ini melalui tautan lengkap yang dibagikan pengelola lab.</p>`
    );
  }

  function gagalMuat(err) {
    console.error(err);
    const lokal = location.protocol === "file:";
    tanpaData(lokal
      ? `<p><b>Data katalog tidak bisa dimuat.</b></p>
         <p>Halaman ini dibuka langsung dari file, sedangkan browser hanya mengizinkan pembacaan <code>${SUMBER_DATA}</code> lewat server web.
         Jalankan server lokal di folder ini (misalnya <code>py -m http.server</code> lalu buka <code>http://localhost:8000</code>) atau buka lewat GitHub Pages.</p>`
      : `<p><b>Data katalog tidak bisa dimuat.</b></p><p>Periksa apakah berkas datanya ada dan penulisan JSON-nya benar. Rincian: ${esc(err.message)}</p>`);
  }

  async function ambilData() {
    if (!TERENKRIPSI) {
      const res = await fetch(SUMBER_DATA, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }
    const res = await fetch(SUMBER_TERENKRIPSI, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sandi = await res.arrayBuffer();
    let polos;
    try {
      KUNCI = await imporKunci(KUNCI_TEKS);
      polos = await dekripsi(sandi);
    } catch (err) {
      throw Object.assign(new Error("Kunci salah"), { kunciSalah: true });
    }
    const data = JSON.parse(new TextDecoder().decode(polos));
    TIPE = data.berkas || {};
    return data;
  }

  async function mulai() {
    if (TERENKRIPSI) {
      KUNCI_TEKS = parameter().get("k") || "";
      if (!KUNCI_TEKS) return terkunci(false);
      if (!window.crypto || !crypto.subtle) return gagalMuat(new Error("Browser ini tidak mendukung dekripsi; buka lewat HTTPS dengan browser terbaru."));
    }
    try {
      siapkan(await ambilData());
    } catch (err) {
      return err.kunciSalah ? terkunci(true) : gagalMuat(err);
    }
    ringkasan();
    chips();
    pasangEvent();
    render();
    dariHash();
  }

  mulai();
})();
