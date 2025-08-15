import type { PolicyDocument } from './types';

export const privacyPolicy: PolicyDocument = {
  title: 'Privacy Policy',
  effectiveDate: '08.15.2025',
  lastUpdated: '08.15.2025',
  headerImage: {
    src: '/src/assets/images/cyano_sweat_logo.jpg',
    alt: 'Pyre sauna logo with cyan accent',
    ariaLabel: 'Privacy Policy header image'
  },
  intro:
    'Pyre LLC ("we," "us," or "our") operates the pyresauna.com website (the "Service"). This Privacy Policy informs you of our policies regarding the collection, use, and disclosure of personal data when you use our Service and the choices you have associated with that data. By using our Service, you agree to the collection and use of information in accordance with this policy.',
  sections: [
    {
      heading: 'Information We Collect',
      lists: [
        {
          title: 'Information You Provide to Us',
          items: [
            { text: 'Email Addresses: When you sign up for our mailing list or create an account' },
            { text: 'Account Information: When you create an account to manage bookings (handled by third-party processors)' },
            { text: 'Booking Information: Details necessary to provide sauna session services' },
            { text: 'Payment Information: Credit card and billing information (processed by third-party payment processors)' }
          ]
        },
        {
          title: 'Information We Collect Automatically',
          items: [
            { text: 'Usage Data: Information about how you access and use our website' },
            { text: 'Device Information: Information about your device, browser, and internet connection' },
            { text: 'Analytics Data: Through Google Analytics, including pages visited, time spent, and user interactions' }
          ]
        }
      ]
    },
    {
      heading: 'How We Use Your Information',
      paragraphs: ['We use the collected data for various purposes:'],
      lists: [
        {
          items: [
            { text: 'To provide and maintain our Service' },
            { text: 'To process and manage your bookings' },
            { text: 'To send you marketing communications (with your consent)' },
            { text: 'To improve our services and develop new offerings' },
            { text: 'To analyze usage patterns and make business decisions' },
            { text: 'To comply with legal obligations' }
          ]
        }
      ]
    },
    {
      heading: 'Legal Basis for Processing (GDPR)',
      paragraphs: [
        'If you are from the European Economic Area (EEA), our legal basis for collecting and using your personal information depends on the data concerned and the context in which we collect it. We may process your personal data because:'
      ],
      lists: [
        {
          items: [
            { text: 'We need to perform a contract with you' },
            { text: 'You have given us consent to do so' },
            { text: 'The processing is in our legitimate interests' },
            { text: 'We need to comply with legal obligations' }
          ]
        }
      ]
    },
    {
      heading: 'Information Sharing and Disclosure',
      paragraphs: [
        'We do not sell, trade, or otherwise transfer your personal information to third parties except as described below:'
      ],
      lists: [
        {
          title: 'Third-Party Service Providers',
          items: [
            { text: 'Payment Processors: To process payments for bookings and merchandise' },
            { text: 'Booking Platform: Third-party service that handles account creation and booking management' },
            { text: 'Email Marketing: Mailchimp for sending marketing communications' },
            { text: 'Analytics: Google Analytics for website usage analysis' }
          ]
        }
      ]
    },
    {
      heading: 'Legal Requirements',
      paragraphs: [
        'We may disclose your information if required to do so by law or in response to valid requests by public authorities.'
      ]
    },
    {
      heading: 'Data Security',
      paragraphs: [
        'We implement appropriate technical and organizational security measures to protect your personal information. However, no method of transmission over the Internet or electronic storage is 100% secure.'
      ]
    },
    {
      heading: 'Data Retention',
      paragraphs: [
        'We retain your personal information only for as long as necessary to fulfill the purposes outlined in this Privacy Policy, unless a longer retention period is required by law.'
      ]
    },
    {
      heading: 'Your Data Protection Rights',
      lists: [
        {
          title: 'General Rights',
          items: [
            { text: 'Access: Request copies of your personal data' },
            { text: 'Rectification: Request correction of inaccurate data' },
            { text: 'Erasure: Request deletion of your personal data' },
            { text: 'Portability: Request transfer of your data' },
            { text: 'Objection: Object to processing of your personal data' }
          ]
        },
        {
          title: 'California Residents (CCPA)',
          items: [
            { text: 'Right to know what personal information is collected' },
            { text: 'Right to delete personal information' },
            { text: 'Right to opt-out of the sale of personal information (we do not sell personal information)' },
            { text: 'Right to non-discrimination' }
          ]
        }
      ],
      paragraphs: [
        'To exercise these rights, contact us at legal@pyresauna.com.'
      ]
    },
    {
      heading: "Children's Privacy",
      paragraphs: [
        'Our Service is not intended for children under 13. We do not knowingly collect personal information from children under 13. If you become aware that a child has provided us with personal data, please contact us.'
      ]
    },
    {
      heading: 'Changes to This Privacy Policy',
      paragraphs: [
        'We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Effective Date."'
      ]
    },
    {
      heading: 'Contact Us',
      lists: [
        {
          items: [
            { text: 'Email: legal@pyresauna.com' },
            { text: 'Company: Pyre LLC' },
            { text: 'Location: Richmond, VA' }
          ]
        }
      ]
    }
  ]
};

export const cookiePolicy: PolicyDocument = {
  title: 'Cookie Policy',
  effectiveDate: '08.15.2025',
  lastUpdated: '08.15.2025',
  headerImage: {
    src: '/src/assets/images/sky_field.jpeg',
    alt: 'Sky and field landscape',
    ariaLabel: 'Cookie Policy header image'
  },
  intro:
    'Cookies are small text files that are stored on your device when you visit our website. They help us provide you with a better experience by remembering your preferences and understanding how you use our site.',
  sections: [
    {
      heading: 'What Are Cookies',
      paragraphs: [
        'Cookies are small text files that are stored on your device when you visit our website. They help us provide you with a better experience by remembering your preferences and understanding how you use our site.'
      ]
    },
    {
      heading: 'How We Use Cookies',
      paragraphs: ['Pyre LLC uses cookies for the following purposes:'],
      lists: [
        {
          title: 'Essential Cookies',
          items: [
            { text: 'Session cookies for maintaining your connection' },
            { text: 'Security cookies for protecting against fraud' },
            { text: 'Load balancing cookies for website performance' }
          ]
        },
        {
          title: 'Analytics Cookies',
          items: [
            { text: 'Analyze website traffic and usage patterns' },
            { text: "Improve our website's functionality" },
            { text: 'Make informed business decisions about our services' }
          ]
        }
      ]
    },
    {
      heading: 'Google Analytics Cookies',
      paragraphs: [
        'We use Google Analytics cookies to understand how visitors interact with our website.'
      ],
      lists: [
        {
          title: 'Google Analytics Cookies',
          items: [
            { text: '_ga: Distinguishes unique users' },
            { text: '_ga_*: Used to persist session state' },
            { text: '_gid: Distinguishes unique users' }
          ]
        }
      ]
    },
    {
      heading: 'Third-Party Cookies',
      paragraphs: [
        'Google Analytics: We use Google Analytics to analyze website usage. Google may use the data collected to contextualize and personalize ads in its advertising network. For more information about Google\'s privacy practices, visit: https://policies.google.com/privacy',
        'Mailchimp: When you interact with our email signup forms, Mailchimp may set cookies to track the effectiveness of our email campaigns.'
      ]
    },
    {
      heading: 'Managing Cookies',
      paragraphs: [
        'You can control and/or delete cookies through your browser settings. Most browsers allow you to view what cookies are stored, delete existing cookies, block cookies from being set, and set preferences for certain websites.'
      ]
    },
    {
      heading: 'Opt-Out Options',
      paragraphs: [
        'Google Analytics: You can opt-out by installing the Google Analytics Opt-out Browser Add-on: https://tools.google.com/dlpage/gaoptout'
      ]
    },
    {
      heading: 'Impact of Disabling Cookies',
      lists: [
        {
          items: [
            { text: 'Essential website functions will still work' },
            { text: "We won't be able to remember your preferences" },
            { text: "Analytics data won't be collected from your visits" },
            { text: 'Some features may not work as expected' }
          ]
        }
      ]
    },
    {
      heading: 'Cookie Consent',
      paragraphs: [
        'By continuing to use our website, you consent to our use of cookies as described in this policy. You can withdraw your consent at any time by adjusting your browser settings.'
      ]
    },
    {
      heading: 'Updates to This Policy',
      paragraphs: [
        'We may update this Cookie Policy from time to time. Any changes will be posted on this page with an updated effective date.'
      ]
    },
    {
      heading: 'Contact Us',
      lists: [
        {
          items: [
            { text: 'Email: legal@pyresauna.com' },
            { text: 'Company: Pyre LLC' },
            { text: 'Location: Richmond, VA' }
          ]
        }
      ]
    }
  ]
};

export const termsOfService: PolicyDocument = {
  title: 'Terms of Service',
  effectiveDate: '08.15.2025',
  lastUpdated: '08.15.2025',
  headerImage: {
    src: '/src/assets/images/red_flowers_in_hand.jpeg',
    alt: 'Red flowers held in hand',
    ariaLabel: 'Terms of Service header image'
  },
  sections: [
    {
      heading: 'Acceptance of Terms',
      paragraphs: [
        'By accessing and using the pyresauna.com website (the "Service") operated by Pyre LLC ("we," "us," or "our"), you accept and agree to be bound by the terms and provision of this agreement.'
      ]
    },
    {
      heading: 'Description of Service',
      paragraphs: [
        'Pyre LLC provides sauna and wellness services through pop-up events and our bathhouse facility in Richmond, VA. Through our website, you can:',
        '- Sign up for our mailing list',
        '- Book sauna sessions',
        '- Purchase merchandise',
        '- Access information about our services'
      ]
    },
    {
      heading: 'User Accounts',
      lists: [
        {
          title: 'Account Creation',
          items: [
            { text: 'You may create an account to manage bookings and purchases' },
            { text: 'You must provide accurate and complete information' },
            { text: 'You are responsible for maintaining the security of your account' },
            { text: 'You must be at least 13 years old to create an account' }
          ]
        },
        {
          title: 'Account Responsibilities',
          items: [
            { text: 'You are responsible for all activities under your account' },
            { text: 'Notify us immediately of any unauthorized use' },
            { text: 'We reserve the right to suspend or terminate accounts for violations' }
          ]
        }
      ]
    },
    {
      heading: 'Booking and Payment Terms',
      lists: [
        {
          title: 'Reservations',
          items: [
            { text: 'All bookings are subject to availability' },
            { text: 'Confirmation is required before your reservation is guaranteed' },
            { text: 'Session times are strictly enforced' }
          ]
        },
        {
          title: 'Payment',
          items: [
            { text: 'Payment is processed through third-party payment processors' },
            { text: 'All prices are in USD and subject to change' },
            { text: 'Payment is required at the time of booking' }
          ]
        },
        {
          title: 'Cancellation and Refund Policy',
          items: [
            { text: 'Cancellations: Must be made at least 24 hours before your scheduled session' },
            { text: 'No-shows: Will be charged the full session fee' },
            { text: 'Refunds: Available for cancellations made within the specified timeframe' },
            { text: 'Weather/Emergency Cancellations: Full refunds provided for cancellations due to circumstances beyond our control' }
          ]
        }
      ]
    },
    {
      heading: 'Health and Safety',
      lists: [
        {
          title: 'Health Requirements',
          items: [
            { text: 'You must be in good health to participate in sauna sessions' },
            { text: 'Consult your physician before use if you have any medical conditions' },
            { text: 'Pregnant women, individuals with heart conditions, or other health concerns should seek medical advice' }
          ]
        },
        {
          title: 'Assumption of Risk',
          items: [
            { text: 'You participate in sauna sessions at your own risk' },
            { text: 'We are not liable for any health issues that may arise' },
            { text: 'Follow all posted safety guidelines and staff instructions' }
          ]
        },
        {
          title: 'Age Restrictions',
          items: [
            { text: 'Services are not intended for children under 13' },
            { text: 'Minors must be accompanied by an adult' }
          ]
        }
      ]
    },
    {
      heading: 'Prohibited Uses',
      paragraphs: [
        'You may not use our Service:',
        '- For any unlawful purpose or to solicit others to perform unlawful acts',
        '- To violate any international, federal, provincial, or state regulations, rules, laws, or local ordinances',
        "- To infringe upon or violate our intellectual property rights or the intellectual property rights of others",
        '- To harass, abuse, insult, harm, defame, slander, disparage, intimidate, or discriminate',
        '- To submit false or misleading information',
        '- To interfere with or circumvent the security features of the Service'
      ]
    },
    {
      heading: 'Intellectual Property Rights',
      paragraphs: [
        'All content on our website is owned by Pyre LLC. You may not reproduce, distribute, or create derivative works without permission. Our trademarks and service marks may not be used without written consent.'
      ]
    },
    {
      heading: 'Privacy Policy',
      paragraphs: [
        'Your privacy is important to us. Please review our Privacy Policy, which also governs your use of the Service.'
      ]
    },
    {
      heading: 'Disclaimers',
      lists: [
        {
          title: 'Service Availability',
          items: [
            { text: 'We do not guarantee uninterrupted access to our website' },
            { text: 'Services may be suspended for maintenance or other reasons' },
            { text: 'We reserve the right to modify or discontinue services' }
          ]
        },
        {
          title: 'Limitation of Liability',
          items: [
            { text: 'TO THE FULLEST EXTENT PERMITTED BY LAW, PYRE LLC SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES.' }
          ]
        }
      ]
    },
    {
      heading: 'Indemnification',
      paragraphs: [
        'You agree to defend, indemnify, and hold harmless Pyre LLC from and against any loss, damage, liability, claim, or demand arising out of or related to your use of the Service.'
      ]
    },
    {
      heading: 'Governing Law',
      paragraphs: [
        'These Terms shall be governed by and construed in accordance with the laws of Virginia, without regard to its conflict of law provisions.'
      ]
    },
    {
      heading: 'Dispute Resolution',
      paragraphs: [
        'Any disputes arising from these Terms will be resolved through binding arbitration in Richmond, VA, in accordance with the rules of the American Arbitration Association.'
      ]
    },
    {
      heading: 'Severability',
      paragraphs: [
        'If any provision of these Terms is held to be unenforceable, such provision shall be struck and the remaining provisions shall remain in full force and effect.'
      ]
    },
    {
      heading: 'Changes to Terms',
      paragraphs: [
        'We reserve the right to modify these Terms at any time. Changes will be posted on this page with an updated effective date. Continued use of the Service constitutes acceptance of the modified Terms.'
      ]
    },
    {
      heading: 'Contact Information',
      lists: [
        {
          items: [
            { text: 'Email: legal@pyresauna.com' },
            { text: 'Company: Pyre LLC' },
            { text: 'Location: Richmond, VA' }
          ]
        }
      ]
    }
  ]
};

export default {
  privacyPolicy,
  cookiePolicy,
  termsOfService
};


