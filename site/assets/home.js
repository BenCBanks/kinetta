(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('[data-site-nav]');
  addEventListener('scroll', () => nav?.classList.toggle('is-compact', scrollY > 48), {passive:true});

  const weekDemo = document.querySelector('[data-week-demo]');
  if (weekDemo) {
    const question = weekDemo.querySelector('[data-week-question]');
    const answer = weekDemo.querySelector('[data-week-answer]');
    const replay = weekDemo.querySelector('[data-week-replay]');
    const questionText = 'Am I improving?';
    const answerText = 'Your latest run total is below your recent average; this chart also shows stronger weeks. One week alone cannot establish a lasting trend.';
    let timers = [];
    const stopReplay = () => { timers.forEach(clearTimeout); timers = []; };
    const typeText = (node, text, done) => {
      let i = 0;
      const tick = () => {
        node.textContent = text.slice(0, i++);
        if (i <= text.length) timers.push(setTimeout(tick, 26));
        else done?.();
      };
      tick();
    };
    const playWeek = () => {
      stopReplay();
      if (reduce) { question.textContent = questionText; answer.textContent = answerText; return; }
      question.textContent = ''; answer.textContent = '';
      typeText(question, questionText, () => typeText(answer, answerText));
    };
    replay?.addEventListener('click', playWeek);
    if (!reduce && 'IntersectionObserver' in window) {
      const replayObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { playWeek(); replayObserver.disconnect(); }
      }, {threshold:.35});
      replayObserver.observe(weekDemo);
    }
  }
})();
