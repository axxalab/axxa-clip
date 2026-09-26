/* Animações da página do HotClip v3 (GSAP 3.13, vendor local) — compartilhadas pelas páginas em português e em inglês
   A estrutura: o hero com a máquina de cortes + os três atos de scrollytelling com pin + a demonstração ao vivo do karaokê + o bento */
(function () {
  if (typeof gsap === "undefined") return; // se o script não carregar, a página continua estática e utilizável

  gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, SplitText);
  gsap.defaults({ duration: 0.6, ease: "power2.out" });

  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return gsap.utils.toArray((root || document).querySelectorAll(s)); };

  /* ---- As barras da forma de onda (enfeite gerado por JS, para o HTML ficar limpo) ---- */
  function buildWave(el, n, hotRanges) {
    if (!el) return [];
    var bars = [];
    for (var i = 0; i < n; i++) {
      var b = document.createElement("i");
      var h = 22 + Math.abs(Math.sin(i * 1.7) + Math.sin(i * 0.53)) * 34; // pseudoaleatório, mas determinístico
      b.style.height = h + "%";
      var pos = i / n;
      if (hotRanges && hotRanges.some(function (r) { return pos >= r[0] && pos <= r[1]; })) {
        b.className = "hot";
        b.style.height = Math.min(92, h + 34) + "%";
      }
      el.appendChild(b);
      bars.push(b);
    }
    return bars;
  }
  var filmBars = buildWave($("#film-wave"), 64, [[0.16, 0.25], [0.455, 0.545], [0.75, 0.84]]);
  buildWave($("#phone-wave"), 22, [[0.3, 0.55]]);

  /* ---- O laço que acende palavra por palavra (usado pela legenda do cartão de corte, pela do celular e pela demonstração de karaokê) ---- */
  function lightLoop(words, step, hold) {
    if (!words.length) return null;
    var tl = gsap.timeline({ repeat: -1, repeatDelay: 0.4 });
    words.forEach(function (w, i) {
      tl.call(function () { w.classList.add("lit"); }, null, i * step);
    });
    tl.to({}, { duration: words.length * step + (hold || 1.2) });
    tl.call(function () { words.forEach(function (w) { w.classList.remove("lit"); }); });
    return tl;
  }

  var mm = gsap.matchMedia();

  mm.add(
    {
      reduceMotion: "(prefers-reduced-motion: reduce)",
      isDesktop: "(min-width: 900px)"
    },
    function (context) {
      var reduceMotion = context.conditions.reduceMotion;
      var isDesktop = context.conditions.isDesktop;

      if (reduceMotion) {
        // Movimento reduzido: o pré-ocultamento sai, todo valor dinâmico recebe direto o valor final e nenhuma animação é criada
        document.documentElement.classList.remove("js");
        $$("[data-count]").forEach(function (el) { el.textContent = el.getAttribute("data-count"); });
        $$(".cc-num").forEach(function (el) { el.textContent = el.getAttribute("data-target"); });
        $$(".cc-bar i").forEach(function (el) { el.style.transform = "scaleX(" + (el.getAttribute("data-w") || 1) + ")"; });
        $$(".clip-cap .w, .ph-cap .w").forEach(function (w) { w.classList.add("lit"); });
        var kd = $("#karaoke-line");
        if (kd) kd.style.color = "var(--brand-2)";
        // Com o movimento reduzido, o vídeo de enfeite que tocava sozinho também para
        $$("video.clip-media, video.phone-media").forEach(function (v) {
          v.removeAttribute("autoplay");
          v.pause();
        });
        return;
      }

      /* ================= Primeira tela: a entrada do texto + da máquina de cortes ================= */
      var heroTl = gsap.timeline({ defaults: { duration: 0.7, ease: "power3.out" } });
      heroTl
        .from(".hero .eyebrow", { y: 24, autoAlpha: 0 })
        .from(".hero .sub", { y: 26, autoAlpha: 0 }, "-=0.4")
        .from(".hero .cta .btn", { y: 20, autoAlpha: 0, scale: 0.95, stagger: 0.1 }, "-=0.35")
        .from(".hero .note, .hero .meta-badges", { autoAlpha: 0, duration: 0.5 }, "-=0.25")
        // A máquina: o filme entra deslizando → a forma de onda cresce → a região de corte se acende → o cartão do vídeo pronto sai recortado e sobe
        .from(".rig .film", { y: 46, autoAlpha: 0, duration: 0.7 }, "-=0.2");
      if (filmBars.length) {
        heroTl.from(filmBars, { scaleY: 0, duration: 0.5, stagger: { each: 0.008, from: "start" }, ease: "power1.out" }, "-=0.3");
      }
      heroTl
        .from(".rig .cut", { scale: 0.6, autoAlpha: 0, stagger: 0.12, duration: 0.4, ease: "back.out(2)" }, "-=0.2")
        .from(".rig .flame", { scale: 0, autoAlpha: 0, stagger: 0.12, duration: 0.35, ease: "back.out(3)" }, "-=0.3")
        .from(".rig .clip-card", { y: 130, autoAlpha: 0, rotate: function (i) { return i === 1 ? 0 : (i === 0 ? -5 : 5); }, stagger: 0.14, duration: 0.85, ease: "power3.out" }, "-=0.15")
        .from(".rig .rig-label", { autoAlpha: 0, duration: 0.5 }, "-=0.3");

      // A animação de espera da máquina: o cartão flutua, a chama pisca e a forma de onda da região quente pulsa
      $$(".rig .clip-card").forEach(function (card, i) {
        gsap.to(card, { y: i === 1 ? -10 : -6, duration: 2.2 + i * 0.35, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 1.8 + i * 0.3 });
      });
      gsap.to(".rig .flame", { scale: 1.18, duration: 0.5, yoyo: true, repeat: -1, ease: "sine.inOut", stagger: 0.17, delay: 2 });
      filmBars.filter(function (b) { return b.className === "hot"; }).forEach(function (b, i) {
        gsap.to(b, { scaleY: 0.55, duration: 0.42 + (i % 5) * 0.06, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 2 });
      });
      // O laço que acende palavra por palavra a legenda dos três cartões
      $$(".rig .clip-card").forEach(function (card, i) {
        var loop = lightLoop($$(".clip-cap .w", card), 0.5, 1.4);
        if (loop) loop.delay(2 + i * 0.6);
      });

      /* ---- O H1 entra palavra por palavra (depois de a fonte ficar pronta, para a quebra de linha não sair torta) ---- */
      document.fonts.ready.then(function () {
        var title = $("#hero-title");
        if (!title) return;
        SplitText.create(title, {
          type: "chars",
          autoSplit: true,
          onSplit: function (self) {
            return gsap.from(self.chars, { y: 26, autoAlpha: 0, stagger: 0.022, duration: 0.55, ease: "power3.out" });
          }
        });
      });

      /* ================= Os três atos do scrollytelling ================= */
      var stageWrap = $(".scrolly .stage-wrap");
      if (stageWrap && isDesktop) {
        stageWrap.classList.add("js-pin");
        var sps = $$(".stage-progress .sp");
        var setActive = function (idx) {
          sps.forEach(function (sp, i) { sp.classList.toggle("active", i === idx); });
        };
        gsap.set(".stage-2, .stage-3", { autoAlpha: 0 });

        var ccProxy = { val: 0 };
        var ccNum = $(".stage-2 .cc-num");
        var ccTarget = ccNum ? parseInt(ccNum.getAttribute("data-target"), 10) : 92;

        var pinTl = gsap.timeline({
          scrollTrigger: {
            trigger: stageWrap,
            start: "top 12%",
            end: "+=2400",
            pin: true,
            scrub: 0.6,
            onUpdate: function (self) {
              setActive(self.progress < 0.3 ? 0 : (self.progress < 0.66 ? 1 : 2));
            }
          },
          defaults: { ease: "power2.out" }
        });

        pinTl
          // Ato 1: o arquivo entra voando na bandeja
          .from(".stage-1 .file-chip", { x: function (i) { return [-120, 140, -90][i]; }, y: function (i) { return [-80, -60, 90][i]; }, autoAlpha: 0, stagger: 0.15, duration: 0.8 })
          .to(".stage-1 .file-chip", { x: 0, y: 0, scale: 0.92, duration: 0.6 })
          .to({}, { duration: 0.4 })
          // Ato 1 → ato 2
          .to(".stage-1", { autoAlpha: 0, y: -30, duration: 0.5 })
          .to(".stage-2", { autoAlpha: 1, duration: 0.5 }, "<0.2")
          .from(".stage-2 .cand-card", { y: 60, duration: 0.6 }, "<")
          .fromTo(".stage-2 .cc-dims .cc-bar i", { scaleX: 0 }, {
            scaleX: function (i, el) { return parseFloat(el.getAttribute("data-w") || 1); },
            stagger: 0.1, duration: 0.5
          }, "<0.3")
          .to(ccProxy, {
            val: ccTarget, duration: 0.8,
            onUpdate: function () { if (ccNum) ccNum.textContent = Math.round(ccProxy.val); }
          }, "<")
          .from(".stage-2 .cand-mini", { y: 30, autoAlpha: 0, duration: 0.5 }, "<0.4")
          .to({}, { duration: 0.5 })
          // Ato 2 → ato 3
          .to(".stage-2", { autoAlpha: 0, y: -30, duration: 0.5 })
          .to(".stage-3", { autoAlpha: 1, duration: 0.5 }, "<0.2")
          .from(".stage-3 .phone", { y: 90, rotate: -4, duration: 0.7 }, "<")
          .from(".stage-3 .export-item", { x: -40, autoAlpha: 0, stagger: 0.12, duration: 0.45 }, "<0.3")
          .to({}, { duration: 0.6 });
      } else if (stageWrap) {
        // No celular e em telas estreitas: sem pin, os três atos ficam na vertical e entram com a rolagem
        $$(".scrolly .stage").forEach(function (st) {
          gsap.from(st, {
            autoAlpha: 0, y: 50, duration: 0.7,
            scrollTrigger: { trigger: st, start: "top 82%", once: true }
          });
        });
        var ccNumM = $(".stage-2 .cc-num");
        if (ccNumM) {
          var proxyM = { val: 0 };
          gsap.to(proxyM, {
            val: parseInt(ccNumM.getAttribute("data-target"), 10), duration: 1.2,
            scrollTrigger: { trigger: ccNumM, start: "top 85%", once: true },
            onUpdate: function () { ccNumM.textContent = Math.round(proxyM.val); }
          });
        }
        $$(".stage-2 .cc-bar i").forEach(function (bar) {
          gsap.fromTo(bar, { scaleX: 0 }, {
            scaleX: parseFloat(bar.getAttribute("data-w") || 1), duration: 0.8,
            scrollTrigger: { trigger: bar, start: "top 90%", once: true }
          });
        });
        $(".stage-progress") && ($(".stage-progress").style.display = "none");
      }
      // A legenda do celular acende palavra por palavra (nos dois modos)
      lightLoop($$(".stage-3 .ph-cap .w"), 0.55, 1.5);

      /* ================= A demonstração ao vivo do karaokê ================= */
      var kdLine = $("#karaoke-line");
      if (kdLine) {
        document.fonts.ready.then(function () {
          SplitText.create(kdLine, {
            type: "chars",
            autoSplit: true,
            aria: "hidden", /* o elemento p desliga o aria-label; o sentido da linha de demonstração vem da region que a envolve */
            onSplit: function (self) {
              var tl = gsap.timeline({ repeat: -1, repeatDelay: 0.9, scrollTrigger: { trigger: kdLine, start: "top 88%" } });
              self.chars.forEach(function (c, i) {
                tl.call(function () { c.classList.add("lit"); }, null, i * 0.09);
              });
              tl.to({}, { duration: self.chars.length * 0.09 + 1.4 });
              tl.call(function () { self.chars.forEach(function (c) { c.classList.remove("lit"); }); });
              return tl;
            }
          });
        });
      }

      /* ================= A entrada geral com a rolagem ================= */
      gsap.set("[data-reveal]", { autoAlpha: 0, y: 40 });
      ScrollTrigger.batch("[data-reveal]", {
        start: "top 85%",
        once: true,
        onEnter: function (items) {
          gsap.to(items, { autoAlpha: 1, y: 0, stagger: 0.1, duration: 0.6, overwrite: true });
        }
      });

      /* ---- O mini cartão de candidato dentro do bento: as barras crescem na entrada ---- */
      $$(".b-hotspot .cc-bar i").forEach(function (bar) {
        gsap.fromTo(bar, { scaleX: 0 }, {
          scaleX: parseFloat(bar.getAttribute("data-w") || 1), duration: 0.9, ease: "power2.out",
          scrollTrigger: { trigger: bar, start: "top 88%", once: true }
        });
      });
      /* ---- A contagem dos números correndo ---- */
      $$("[data-count]").forEach(function (el) {
        var target = parseFloat(el.getAttribute("data-count"));
        var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
        var proxy = { val: 0 };
        gsap.to(proxy, {
          val: target, duration: 1.2, ease: "power1.out",
          scrollTrigger: { trigger: el, start: "top 90%", once: true },
          onUpdate: function () { el.textContent = proxy.val.toFixed(decimals); }
        });
      });

      /* ---- A tabela de comparação acendendo linha a linha ---- */
      var rows = $$("#compare-table tbody tr");
      if (rows.length) {
        gsap.set(rows, { autoAlpha: 0, x: -24 });
        gsap.to(rows, {
          autoAlpha: 1, x: 0, stagger: 0.1, duration: 0.5,
          scrollTrigger: { trigger: "#compare-table", start: "top 80%", once: true }
        });
      }

      /* ---- O paralaxe do brilho do fundo + a barra de progresso do topo ---- */
      $$(".glow").forEach(function (glow, i) {
        gsap.to(glow, {
          yPercent: i % 2 ? -28 : 22, ease: "none",
          scrollTrigger: { trigger: document.body, start: "top top", end: "max", scrub: 1 }
        });
      });
      gsap.to(".progress", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });

      /* ---- O letreiro das plataformas ---- */
      var track = $(".marquee-track");
      if (track && !track.dataset.cloned) {
        track.dataset.cloned = "1";
        track.innerHTML += track.innerHTML.replace(/<span class="p"/g, '<span aria-hidden="true" class="p"');
        var marquee = gsap.to(track, { xPercent: -50, ease: "none", duration: 26, repeat: -1 });
        track.parentElement.addEventListener("mouseenter", function () { marquee.pause(); });
        track.parentElement.addEventListener("mouseleave", function () { marquee.play(); });
      }

      /* ---- A animaçãozinha de abrir o FAQ ---- */
      $$("#faq details").forEach(function (d) {
        d.addEventListener("toggle", function () {
          if (d.open) gsap.from(d.querySelectorAll("p"), { autoAlpha: 0, y: -8, duration: 0.35 });
        });
      });

      return function () { if (stageWrap) stageWrap.classList.remove("js-pin"); };
    }
  );

  /* ---- A rolagem suave até a âncora da navegação (o CSS não define scroll-behavior, para não brigar) ---- */
  var NAV_OFFSET = 68;
  document.querySelectorAll('nav a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      var target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      gsap.to(window, { duration: 0.8, ease: "power2.inOut", scrollTo: { y: target, offsetY: NAV_OFFSET } });
    });
  });

  /* ---- A barra do topo ganha uma linha divisória depois da rolagem ---- */
  var nav = document.getElementById("sitenav");
  if (nav) {
    ScrollTrigger.create({
      start: 10,
      onEnter: function () { nav.classList.add("scrolled"); },
      onLeaveBack: function () { nav.classList.remove("scrolled"); }
    });
  }

  /* ---- Depois de todas as imagens carregarem, as posições de disparo são recalculadas ---- */
  window.addEventListener("load", function () { ScrollTrigger.refresh(); });

  /* ---- O número de estrelas e a versão do GitHub (a falha é silenciosa, e o valor estático fica de reserva) ---- */
  function fmtStars(n) {
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
  }
  fetch("https://api.github.com/repos/xixihhhh/hotclip")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || typeof data.stargazers_count !== "number") return;
      var el = document.getElementById("gh-stars");
      if (el) el.textContent = "★ " + fmtStars(data.stargazers_count);
      var navEl = document.getElementById("gh-stars-nav");
      if (navEl) navEl.textContent = " ★" + fmtStars(data.stargazers_count);
    })
    .catch(function () {});
  fetch("https://api.github.com/repos/xixihhhh/hotclip/releases/latest")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.tag_name) return;
      var el = document.getElementById("gh-version");
      if (el) el.textContent = data.tag_name;
    })
    .catch(function () {});
})();
