import { founding } from './membership';
import sessions, { introMembershipPerk, introOffer, SINGLE_CREDIT_PRICE } from './sessions';
import type { FAQContent } from './types';

/** Cheapest multi-credit pack, for "credit packs start at …". */
const smallestPack = sessions.items.find((item) => item.id === 'pack-2');

const faqs: FAQContent = {
  title: 'Frequently Asked Questions',
  items: [
    {
      question: "I've never done a sauna or cold plunge. Is Pyre for me?",
      answer: `Absolutely. No experience needed. Our certified sauna masters lead guided sessions with full instruction, and staff are always around to help you through your first visit. The easiest way to start is the intro: ${introOffer.sentence.charAt(0).toLowerCase()}${introOffer.sentence.slice(1)}.`,
    },
    {
      question: 'What happens after my intro?',
      answer: `${introMembershipPerk} Prefer to come less often? Credit packs start at $${smallestPack?.price ?? SINGLE_CREDIT_PRICE} for ${smallestPack?.name.toLowerCase() ?? '1 credit'}, and every credit can be shared with friends and family.`,
    },
    {
      question: 'Can I pause or cancel my membership?',
      answer: `You can pause your membership for up to 3 months in any 12-month period, and your founding rate stays the same. If you cancel, the founding rate ends, and rejoining later would be at the standard $${founding.unlimited.originalPrice}/mo.`,
    },
    {
      question: 'What should I bring to my session?',
      answer:
        'Bring a swimsuit, a water bottle and an optional robe / sandals. We provide towels and all the amenities you need for your session.',
    },
    {
      question: 'Where should I park?',
      answer:
        'Street parking is available on Westover Hills Blvd. and W 49th St. You can also park in the gravel lot off W 49th St. (look for the big Pyre sign on our sauna) or in the lot off Westover Hills Blvd. marked by the Living Water sign.',
    },
    {
      question: 'How hot does the sauna get?',
      answer: 'Our traditional Finnish saunas reach temperatures between 170-195°F.',
    },
    {
      question: 'How cold is the cold plunge?',
      answer:
        'Our cold plunge pools are maintained between 39-50°F. We recommend starting with shorter immersions and gradually increasing your time as you become more comfortable.',
    },
    {
      question: 'Is contrast therapy safe?',
      answer:
        'Contrast therapy is safe for healthy adults. However, if you have cardiovascular conditions, high blood pressure, or are pregnant, please consult your doctor before participating. Stay hydrated and listen to your body.',
    },
    {
      question: 'How long should I stay in the sauna and cold plunge?',
      answer:
        'We recommend 10-20 minute sauna sessions followed by 1-3 minute cold plunge immersions. Repeat 2-4 rounds for optimal benefits. Our staff can guide you through your first session.',
    },
    {
      question: 'Do I need to book in advance?',
      answer:
        'We recommend booking in advance to guarantee your preferred time slot. Walk-ins are welcome based on availability, but booking ensures you get your desired session time.',
    },
    {
      question: 'What happens in bad weather?',
      answer:
        "We're open rain or shine and only cancel for thunder, lightning, or other extreme weather. If weather ends your session before you've completed at least three-quarters of it, we refund your credits.",
    },
    {
      question: 'What are the benefits of contrast therapy?',
      answer:
        'Contrast therapy can improve circulation, reduce muscle soreness, boost immune function, enhance mental clarity, reduce stress, and promote better sleep. Regular practice amplifies these benefits.',
    },
    {
      question: 'Can I bring guests?',
      answer:
        'Yes! You can book for your friends and family when signing up for a session. Founding Unlimited members get 4 guest passes a month, intro guests get 1, and you can book a group session for private events.',
    },
  ],
};

export default faqs;
