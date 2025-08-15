import type { PolicyDocument } from './types';

export const healthSafety: PolicyDocument = {
  title: 'Health & Safety',
  effectiveDate: '08.15.2025',
  headerImage: {
    src: '/src/assets/images/sauna_ladle.jpeg',
    alt: 'A wooden ladle rests in a bucket in a sauna, steam rising from the hot stones in the background.',
    ariaLabel: 'Health and Safety header image'
  },
  intro:
    'Your health and safety are our top priorities. We are committed to providing a safe, clean, and restorative environment for all our guests. Please review these guidelines carefully before your visit to ensure a seamless and enjoyable experience that aligns with our community values.',
  sections: [
    {
      heading: 'Welcome to a Safe & Restorative Space',
      paragraphs: [
        'At Pyre, we are dedicated to creating a sanctuary where you can relax, recharge, and disconnect. To ensure the well-being of every guest, we have established the following health and safety protocols. Your cooperation helps us maintain a welcoming and secure environment for everyone.'
      ]
    },
    {
      heading: 'Essential Health Guidelines',
      paragraphs: [
        'To protect yourself and others, please consider the following before your visit:'
      ],
      lists: [
        {
          title: 'Pre-Visit Health Check',
          items: [
            { text: 'If you are feeling unwell, have a fever, or are exhibiting symptoms of a contagious illness, please reschedule your visit.' },
            { text: 'Guests with open wounds, sores, or skin infections should not use the facilities.' }
          ]
        },
        {
          title: 'Medical Considerations',
          items: [
            { text: 'Consult your physician before using the sauna, cold plunge, or hot pool if you are pregnant, have a heart condition, high/low blood pressure, or other serious medical issues.' },
            { text: 'Inform our staff of any health conditions or allergies that may affect your experience.' }
          ]
        }
      ]
    },
    {
      heading: 'Facility Protocols',
      paragraphs: [
        'To ensure a safe and enjoyable experience for all, please adhere to the following protocols in each area of our facility:'
      ],
      lists: [
        {
          title: 'Sauna Etiquette',
          items: [
            { text: 'Always sit on a towel.' },
            { text: 'Limit your sessions to 15-20 minutes at a time.' },
            { text: 'Listen to your body and exit if you feel dizzy or lightheaded.' },
            { text: 'No outside oils, lotions, or scents are permitted.' }
          ]
        },
        {
          title: 'Cold Plunge Safety',
          items: [
            { text: 'Shower before entering the cold plunge.' },
            { text: 'Enter and exit the plunge slowly and carefully.' },
            { text: 'Limit your time in the cold plunge to a few minutes.' }
          ]
        },
        {
          title: 'Hot Pool Guidelines',
          items: [
            { text: 'Hydrate well before and after using the hot pool.' },
            { text: 'Be mindful of the hot water and surfaces.' }
          ]
        }
      ]
    },
    {
      heading: 'Hygiene Standards',
      paragraphs: [
        'Cleanliness is a cornerstone of the Pyre experience. We ask for your help in maintaining our high standards:'
      ],
      lists: [
        {
          title: 'Showering & Cleanliness',
          items: [
            { text: 'A full-body shower with soap is required before using any of the facilities.' },
            { text: 'Please shower after your session before dressing.' }
          ]
        },
        {
          title: 'Swimwear & Attire',
          items: [
            { text: 'Clean, appropriate swimwear is required in all communal areas.' },
            { text: 'Street shoes are not permitted beyond the reception area.' }
          ]
        }
      ]
    },
    {
      heading: 'Behavioral Expectations',
      paragraphs: [
        'Our community is built on respect and mindfulness. Please observe the following guidelines:'
      ],
      lists: [
        {
          title: 'Respect for Others',
          items: [
            { text: 'Maintain a quiet, meditative atmosphere. Speak softly and avoid loud conversations.' },
            { text: 'Respect the personal space of other guests.' },
            { text: 'No electronic devices are permitted in the thermal areas.' }
          ]
        }
      ]
    },
    {
      heading: 'Emergency Procedures',
      paragraphs: [
        'Your safety is our priority. In case of an emergency, please follow these procedures:'
      ],
      lists: [
        {
          title: 'Staff Assistance',
          items: [
            { text: 'Alert a staff member immediately if you or another guest requires assistance.' }
          ]
        },
        {
          title: 'Evacuation',
          items: [
            { text: 'In the event of an evacuation, please follow staff instructions and exit calmly.' }
          ]
        }
      ]
    },
    {
      heading: 'Reservations & Check-In',
      paragraphs: [
        'To ensure a smooth experience, please note our reservation and check-in policies:'
      ],
      lists: [
        {
          title: 'Booking & Cancellation',
          items: [
            { text: 'Reservations are required and can be made online.' },
            { text: 'Please review our cancellation policy, available on our Terms of Service page.' }
          ]
        },
        {
          title: 'Check-In',
          items: [
            { text: 'Please arrive 15 minutes before your scheduled appointment to allow time for check-in and orientation.' }
          ]
        }
      ]
    },
    {
      heading: 'Contact & Support',
      paragraphs: [
        'We are here to help. If you have any questions or concerns about our health and safety guidelines, please do not hesitate to contact us.'
      ],
      lists: [
        {
          items: [
            { text: 'Email: support@pyresauna.com' },
            { text: 'Visit our FAQ page for more information.' }
          ]
        }
      ]
    }
  ]
};

export default healthSafety;
