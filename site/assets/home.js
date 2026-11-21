(() => {
  'use strict';
  const nav = document.querySelector('[data-site-nav]');
  addEventListener('scroll', () => nav?.classList.toggle('is-compact', scrollY > 48), {passive:true});

  const question = document.querySelector('[data-week-question]');
  const answer = document.querySelector('[data-week-answer]');
  document.querySelectorAll('[data-week-example]').forEach(button => {
    button.addEventListener('click', () => {
      question.textContent = button.dataset.question;
      answer.textContent = button.dataset.answer;
    });
  });
})();
