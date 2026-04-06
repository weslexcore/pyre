import type { TestimonialsContent } from './types';

const testimonials: TestimonialsContent = {
  title: 'What Our Community Says',
  subtitle: 'Real experiences from our members',
  items: [
    {
      id: 'testimonial-0',
      name: 'Emily M.',
      quote:
        'A transformative experience inside and out. My inner landscape feels tended to with thoughtful guided questions, my body buzzing from the heat and cold, and my mind is calmer and clearer.',
      highlight: true,
    },
    {
      id: 'testimonial-2',
      name: 'Jarrod A.',
      quote:
        'I like the social aspect of the experience. Being around health conscious people makes trying to connect with people easier. It is like going to a bar for healthy people.',
    },
    {
      id: 'testimonial-1',
      name: 'Sarah S.',
      quote:
        'The facilitated questions give people the opportunity to be vulnerable in a safe space. I walk away feeling empowered, grounded, and equipped to handle stressors.',
      highlight: true,
    },
    {
      id: 'testimonial-3',
      name: 'Kat C.',
      quote:
        'The intention set for the session, community experience and support from the Pyre team. The balance of guidance and free time was perfect.',
      highlight: true,
    },
  ],
  closing: 'Join our growing community finding balance through contrast therapy.',
};

export default testimonials;
