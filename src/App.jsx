import { useEffect, useRef, useState } from 'react'
import './App.css'
import cartLogo from '../logo asset/cart-logo.png'
import CheckoutPage from './components/CheckoutPage'
import DevPage from './components/DevPage'
import LiquidGlassCarouselSection from './components/LiquidGlassCarousel'
import ProductCard from './components/ProductCard'
import { products } from './data/products'
import {
  deleteStoredProduct,
  getPublicShirtInventory,
  getStoredProducts,
  saveStoredProduct,
  updateStoredProduct,
} from './lib/devPortalStore'
import { buildEstimatedOrderSummary, FREE_SHIPPING_THRESHOLD_CENTS } from './lib/orderSummary'

const merchCategoryLinks = [
  {
    id: 'tees',
    label: 'tees',
    href: '/tees',
    nodeClassName: 'map-stop-tees',
  },
  {
    id: 'dress-shirts',
    label: 'dress shirts',
    href: '/dress-shirts',
    nodeClassName: 'map-stop-dress-shirts',
  },
  {
    id: 'bottoms',
    label: 'bottoms',
    href: '/bottoms',
    nodeClassName: 'map-stop-bottoms',
  },
  {
    id: 'other-merchandise',
    label: 'other merchandise',
    href: '/other-merchandise',
    nodeClassName: 'map-stop-other-merchandise',
  },
]

const categoryLinks = [
  ...merchCategoryLinks,
  {
    id: 'about',
    label: 'about',
    href: '/about',
    nodeClassName: 'map-stop-about',
  },
  {
    id: 'contact',
    label: 'contact',
    href: '/contact',
    nodeClassName: 'map-stop-contact',
  },
]

const featuredFallbackItems = [
  {
    eyebrow: 'featured item 01',
    title: 'Classic Logo Tee',
    price: '$34',
    copy:
      'A homepage spotlight slot for your main tee release, ready for real product photos and final garment notes.',
    image: '/tee-mockup.png',
    accent: 'core staple',
  },
  {
    eyebrow: 'featured item 02',
    title: 'Airbrush Shirt',
    price: '$42',
    copy:
      'Use a second slide for limited-run graphics, seasonal experiments, or any item that deserves extra attention.',
    image: '/tee-mockup-hover.jpg',
    accent: 'limited run',
  },
  {
    eyebrow: 'featured item 03',
    title: 'Poster Edition',
    price: '$24',
    copy:
      'Reserve one carousel slot for a non-apparel object so the featured band can represent the wider store world.',
    image: '/tee-mockup.png',
    accent: 'print object',
  },
  {
    eyebrow: 'featured item 04',
    title: 'Tour Long Sleeve',
    price: '$48',
    copy:
      'Use another slot for a longer-sleeve graphic piece that broadens the collection without changing the visual system.',
    image: '/tee-mockup-hover.jpg',
    accent: 'layering piece',
  },
  {
    eyebrow: 'featured item 05',
    title: 'Washed Cap',
    price: '$30',
    copy:
      'A smaller accessory option helps the preview rail feel more like a full store collection instead of tops only.',
    image: '/tee-mockup.png',
    accent: 'accessory',
  },
  {
    eyebrow: 'featured item 06',
    title: 'Studio Tote',
    price: '$28',
    copy:
      'Keep one additional utility item in the mix so the front-page collection feels varied before real products are loaded.',
    image: '/tee-mockup-hover.jpg',
    accent: 'carry item',
  },
]

const tickerItems = [
  'free domestic shipping over $100',
  'new drop every two weeks',
  'hand-printed in small runs',
  'limited stock once live',
]

const tickerLoopItems = Array.from({ length: 3 }, () => tickerItems).flat()

const merchPageContent = {
  '/tees': {
    eyebrow: 'category one',
    title: 'tees',
    intro:
      'Use this page for the core shirt line: standard logo tees, art tees, and the main print runs that define the season.',
    cards: products,
    details: [],
  },
  '/dress-shirts': {
    eyebrow: '',
    title: 'dress shirts',
    intro:
      '1 of 1, hand-designed dress shirts made with the heart of matsumoto',
    cards: products.map((product, index) => ({
      ...product,
      name: ['Camp Collar Shirt', 'Striped Woven', 'Boxy Oxford', 'Layering Shirt'][index],
      price: [78, 84, 92, 88][index],
      description: [
        'A placeholder for short-sleeve woven shirts with custom print details.',
        'Use this slot for stripe treatments, embroidery, or tonal stitching.',
        'Reserve one option for a more structured shirt with a cleaner finish.',
        'Keep one style open for seasonal fabric experiments or layered looks.',
      ][index],
    })),
    details: [
      {
        kicker: 'materials',
        title: 'Treat fabric as the main story',
        copy:
          'For shirting, the cloth matters as much as the graphic. Use this page to emphasize texture, weight, and finish.',
      },
      {
        kicker: 'styling',
        title: 'Photograph them on body',
        copy:
          'These pieces will read better styled than flat. Plan to use fit photography and a few close-ups.',
      },
      {
        kicker: 'structure',
        title: 'Keep the page restrained',
        copy:
          'Dress shirts should feel slightly more measured than tees, but still live in the same visual system.',
      },
    ],
  },
  '/bottoms': {
    eyebrow: '',
    title: 'bottoms',
    intro:
      '1 of 1, hand-designed pants made with the heart of matsumoto',
    cards: products.map((product, index) => ({
      ...product,
      name: ['Work Pant', 'Wide Short', 'Painter Trouser', 'Track Bottom'][index],
      price: [96, 72, 104, 86][index],
      description: [
        'Use this slot for a durable staple with a clean product story.',
        'A placeholder for a warmer-weather short or easy seasonal bottom.',
        'Reserve space for a more design-forward cut with visible detailing.',
        'Keep one bottom open for a softer or more casual shape.',
      ][index],
    })),
    details: [
      {
        kicker: 'fit',
        title: 'Lead with measurements',
        copy:
          'Bottoms need more fit clarity than tops. This page should eventually include inseam, rise, and silhouette notes.',
      },
      {
        kicker: 'hardware',
        title: 'Highlight construction',
        copy:
          'Use this space later for pocket design, fasteners, stitch details, and fabrication notes.',
      },
      {
        kicker: 'visuals',
        title: 'Use side and rear views',
        copy:
          'Plan for multiple angles so shape and leg opening are obvious before checkout.',
      },
    ],
  },
  '/other-merchandise': {
    eyebrow: 'category four',
    title: 'other merchandise',
    intro:
      'A holding page for posters, hats, totes, small print objects, and whatever else belongs in the wider Matsumoto universe.',
    cards: products.map((product, index) => ({
      ...product,
      name: ['Poster Edition', 'Tote Bag', 'Cap', 'Zine Bundle'][index],
      price: [24, 32, 38, 18][index],
      description: [
        'Use this for posters, signed runs, or collectible print items.',
        'A simple slot for bags, carrying pieces, or utility add-ons.',
        'Reserve one space for headwear or smaller cut-and-sew accessories.',
        'Keep one open area for books, zines, or mixed ephemera.',
      ][index],
    })),
    details: [
      {
        kicker: 'range',
        title: 'Let this page stay flexible',
        copy:
          'This category can hold everything that does not belong under the apparel structure of the store.',
      },
      {
        kicker: 'drops',
        title: 'Use it for limited objects',
        copy:
          'It works well for smaller one-off releases that should not crowd the main category pages.',
      },
      {
        kicker: 'bundles',
        title: 'Useful for mixed offers',
        copy:
          'If you run bundles or set packs later, this is a natural home for those combinations.',
      },
    ],
  },
}

const aboutContent = {
  title: 'about',
  intro:
    'Matsumoto is built around a map-like shopping experience and a restrained visual language that lets the product and layout do the talking.',
  points: [
    {
      kicker: '01',
      title: 'Build a clear product world',
      copy:
        'Each category should feel connected, but distinct enough to justify its own page and its own rhythm.',
    },
    {
      kicker: '02',
      title: 'Keep photography disciplined',
      copy:
        'Good garment photos will matter more than adding more UI or more content blocks everywhere.',
    },
    {
      kicker: '03',
      title: 'Let the design stay sparse',
      copy:
        'The map, typography, and category pages are strongest when they are not overloaded with secondary decoration.',
    },
  ],
  notes: [
    'Use this page later for the real brand story, timeline, or design philosophy.',
    'If you start making collections or releases by season, this can become the place to explain that structure.',
    'You can also use it for sizing philosophy, manufacturing notes, or the meaning behind the label.',
  ],
}

const contactContent = {
  title: 'contact',
  intro:
    'A dedicated contact page for wholesale questions, custom print inquiries, sizing help, and press or collaboration requests.',
  panels: [
    {
      kicker: 'general',
      title: 'jinks@matsumotoshop.com',
      copy:
        'Use this inbox for general store questions, collaboration requests, and customer support.',
    },
    {
      kicker: 'wholesale',
      title: 'Stockist and bulk inquiries',
      copy:
        'Use this block later for wholesale lead times, minimums, or a separate inquiry address if you need one.',
    },
    {
      kicker: 'support',
      title: 'Shipping and order help',
      copy:
        'This section can hold return policy links, support hours, or a small contact form once you add real store operations.',
    },
  ],
}

const faqContent = [
  {
    kicker: 'shipping',
    title: 'When do orders go out?',
    copy:
      'Use this answer slot for dispatch windows, preorder timing, or any note about how quickly orders leave the studio.',
  },
  {
    kicker: 'returns',
    title: 'Can customers return items?',
    copy:
      'Replace this text later with your real return policy, exchange rules, and any final-sale exceptions.',
  },
  {
    kicker: 'sizing',
    title: 'How should customers choose sizing?',
    copy:
      'This section can point people toward garment measurements, fit notes, or a dedicated sizing page when one exists.',
  },
]

const termsOfServiceContent = {
  overview: [
    "This website is operated by matsumoto*. Throughout the site, the terms 'we', 'us' and 'our' refer to matsumoto*. matsumoto* offers this website, including all information, tools and Services available from this site to you, the user, conditioned upon your acceptance of all terms, conditions, policies and notices stated here.",
    "By visiting our site and/or purchasing something from us, you engage in our 'Service' and agree to be bound by the following terms and conditions ('Terms of Service', 'Terms'), including those additional terms and conditions and policies referenced herein and/or available by hyperlink. These Terms of Service apply to all users of the site, including without limitation users who are browsers, vendors, customers, merchants, and/or contributors of content.",
    'Please read these Terms of Service carefully before accessing or using our website. By accessing or using any part of the site, you agree to be bound by these Terms of Service. If you do not agree to all the terms and conditions of this agreement, then you may not access the website or use any Services. If these Terms of Service are considered an offer, acceptance is expressly limited to these Terms of Service.',
    'Any new features or tools which are added to the current store shall also be subject to the Terms of Service. You can review the most current version of the Terms of Service at any time on this page. We reserve the right to update, change or replace any part of these Terms of Service by posting updates and/or changes to our website. It is your responsibility to check this page periodically for changes. Your continued use of or access to the website following the posting of any changes constitutes acceptance of those changes.',
    'Our store is hosted on Stripe. They provide us with the online e-commerce platform that allows us to sell our products and Services to you.',
  ],
  sections: [
    {
      number: '1',
      title: 'online store terms',
      paragraphs: [
        'By agreeing to these Terms of Service, you represent that you are at least the age of majority in your state or province of residence, or that you are the age of majority in your state or province of residence and you have given us your consent to allow any of your minor dependents to use this site.',
        'You may not use our products for any illegal or unauthorized purpose nor may you, in the use of the Service, violate any laws in your jurisdiction, including but not limited to copyright laws.',
        'You must not transmit any worms or viruses or any code of a destructive nature.',
        'A breach or violation of any of the Terms will result in an immediate termination of your Services.',
      ],
    },
    {
      number: '2',
      title: 'general conditions',
      paragraphs: [
        'We reserve the right to refuse Service to anyone for any reason at any time.',
        'You understand that your content, not including credit card information, may be transferred unencrypted and involve transmissions over various networks and changes to conform and adapt to technical requirements of connecting networks or devices. Credit card information is always encrypted during transfer over networks.',
        'You agree not to reproduce, duplicate, copy, sell, resell or exploit any portion of the Service, use of the Service, or access to the Service or any contact on the website through which the Service is provided, without express written permission by us.',
        'The headings used in this agreement are included for convenience only and will not limit or otherwise affect these Terms.',
      ],
    },
    {
      number: '3',
      title: 'accuracy, completeness and timeliness of information',
      paragraphs: [
        'We are not responsible if information made available on this site is not accurate, complete or current. The material on this site is provided for general information only and should not be relied upon or used as the sole basis for making decisions without consulting primary, more accurate, more complete or more timely sources of information. Any reliance on the material on this site is at your own risk.',
        'This site may contain certain historical information. Historical information, necessarily, is not current and is provided for your reference only. We reserve the right to modify the contents of this site at any time, but we have no obligation to update any information on our site. You agree that it is your responsibility to monitor changes to our site.',
      ],
    },
    {
      number: '4',
      title: 'modifications to the service and prices',
      paragraphs: [
        'Prices for our products are subject to change without notice.',
        'We reserve the right at any time to modify or discontinue the Service, or any part or content thereof, without notice at any time.',
        'We shall not be liable to you or to any third-party for any modification, price change, suspension or discontinuance of the Service.',
      ],
    },
    {
      number: '5',
      title: 'products or services',
      paragraphs: [
        'Certain products or Services may be available exclusively online through the website. These products or Services may have limited quantities and are subject to return or exchange only according to our Refund Policy.',
        "We have made every effort to display as accurately as possible the colors and images of our products that appear at the store. We cannot guarantee that your computer monitor's display of any color will be accurate.",
        'We reserve the right, but are not obligated, to limit the sales of our products or Services to any person, geographic region or jurisdiction. We may exercise this right on a case-by-case basis. We reserve the right to limit the quantities of any products or Services that we offer. All descriptions of products or product pricing are subject to change at anytime without notice, at our sole discretion.',
        'We reserve the right to discontinue any product at any time. Any offer for any product or Service made on this site is void where prohibited.',
        'We do not warrant that the quality of any products, Services, information, or other material purchased or obtained by you will meet your expectations, or that any errors in the Service will be corrected.',
      ],
    },
    {
      number: '6',
      title: 'accuracy of billing and account information',
      paragraphs: [
        'We reserve the right to refuse any order you place with us. We may, in our sole discretion, limit or cancel quantities purchased per person, per household or per order. These restrictions may include orders placed by or under the same customer account, the same credit card, and/or orders that use the same billing and/or shipping address.',
        'In the event that we make a change to or cancel an order, we may attempt to notify you by contacting the email and/or billing address or phone number provided at the time the order was made. We reserve the right to limit or prohibit orders that, in our sole judgment, appear to be placed by dealers, resellers or distributors.',
        'You agree to provide current, complete and accurate purchase and account information for all purchases made at our store. You agree to promptly update your account and other information, including your email address and credit card numbers and expiration dates, so that we can complete your transactions and contact you as needed. This can be done by emailing jinks@matsumotoshop.com promptly with changes. If the order has already been shipped, the Refund Policy will be in effect, and the product can be re-ordered with the correct information.',
        'For more details, please review our Refund Policy.',
      ],
    },
    {
      number: '7',
      title: 'third-party links',
      paragraphs: [
        'Certain content, products and Services available via our Service may include materials from third-parties.',
        'Third-party links on this site may direct you to third-party websites that are not affiliated with us. We are not responsible for examining or evaluating the content or accuracy and we do not warrant and will not have any liability or responsibility for any third-party materials or websites, or for any other materials, products, or Services of third-parties.',
        'We are not liable for any harm or damages related to the purchase or use of goods, Services, resources, content, or any other transactions made in connection with any third-party websites. Please review carefully the third-party policies and practices and make sure you understand them before you engage in any transaction. Complaints, claims, concerns, or questions regarding third-party products should be directed to the third-party.',
      ],
    },
    {
      number: '8',
      title: 'user comments, feedback and other submissions',
      paragraphs: [
        "If, at our request, you send certain specific submissions, or without a request from us, you send creative ideas, suggestions, proposals, plans, or other materials, whether online, by email, by postal mail, or otherwise, collectively 'comments', you agree that we may, at any time, without restriction, edit, copy, publish, distribute, translate and otherwise use in any medium any comments that you forward to us.",
        'We are and shall be under no obligation to maintain any comments in confidence, to pay compensation for any comments, or to respond to any comments.',
        'We may, but have no obligation to, monitor, edit or remove content that we determine in our sole discretion to be unlawful, offensive, threatening, libelous, defamatory, pornographic, obscene or otherwise objectionable or violates any party intellectual property or these Terms of Service.',
        'You agree that your comments will not violate any right of any third-party, including copyright, trademark, privacy, personality or other personal or proprietary right. You further agree that your comments will not contain libelous or otherwise unlawful, abusive or obscene material, or contain any computer virus or other malware that could in any way affect the operation of the Service or any related website.',
        'You may not use a false email address, pretend to be someone other than yourself, or otherwise mislead us or third-parties as to the origin of any comments. You are solely responsible for any comments you make and their accuracy. We take no responsibility and assume no liability for any comments posted by you or any third-party.',
      ],
    },
    {
      number: '9',
      title: 'personal information',
      paragraphs: [
        'Your submission of personal information through the store is governed by our Privacy Policy and our Messaging Privacy Policy.',
      ],
      links: [
        { label: 'Privacy Policy', href: '/privacy-policy' },
        { label: 'Messaging Privacy Policy', href: '/messaging-service-privacy-policy' },
      ],
    },
    {
      number: '10',
      title: 'errors, inaccuracies and omissions',
      paragraphs: [
        'Occasionally there may be information on our site or in the Service that contains typographical errors, inaccuracies or omissions that may relate to product descriptions, pricing, promotions, offers, product shipping charges, transit times and availability.',
        'We reserve the right to correct any errors, inaccuracies or omissions, and to change or update information or cancel orders if any information in the Service or on any related website is inaccurate at any time without prior notice, including after you have submitted your order.',
        'We undertake no obligation to update, amend or clarify information in the Service or on any related website, including without limitation pricing information, except as required by law. No specified update or refresh date applied in the Service or on any related website should be taken to indicate that all information in the Service or on any related website has been modified or updated.',
      ],
    },
    {
      number: '11',
      title: 'prohibited uses',
      paragraphs: [
        'In addition to other prohibitions as set forth in the Terms of Service, you are prohibited from using the site or its content for any unlawful purpose; to solicit others to perform or participate in any unlawful acts; to violate any international, federal, provincial or state regulations, rules, laws, or local ordinances; to infringe upon or violate our intellectual property rights or the intellectual property rights of others; to harass, abuse, insult, harm, defame, slander, disparage, intimidate, or discriminate based on gender, sexual orientation, religion, ethnicity, race, age, national origin, or disability.',
        'You are also prohibited from submitting false or misleading information; uploading or transmitting viruses or other malicious code; collecting or tracking the personal information of others; spamming, phishing, pharming, pretexting, spidering, crawling, or scraping; using the site for any obscene or immoral purpose; or interfering with or circumventing the security features of the Service or any related website, other websites, or the Internet.',
        'We reserve the right to terminate your use of the Service or any related website for violating any of the prohibited uses.',
      ],
    },
    {
      number: '12',
      title: 'disclaimer of warranties; limitation of liability',
      paragraphs: [
        'We do not guarantee, represent or warrant that your use of our Service will be uninterrupted, timely, secure or error-free.',
        'We do not warrant that the results that may be obtained from the use of the Service will be accurate or reliable.',
        'You agree that from time to time we may remove the Service for indefinite periods of time or cancel the Service at any time, without notice to you.',
        "You expressly agree that your use of, or inability to use, the Service is at your sole risk. The Service and all products and Services delivered to you through the Service are, except as expressly stated by us, provided 'as is' and 'as available' for your use, without any representation, warranties or conditions of any kind, either express or implied, including all implied warranties or conditions of merchantability, merchantable quality, fitness for a particular purpose, durability, title, and non-infringement.",
        'In no case shall matsumoto*, our directors, officers, employees, affiliates, agents, contractors, interns, suppliers, Service providers or licensors be liable for any injury, loss, claim, or any direct, indirect, incidental, punitive, special, or consequential damages of any kind, including without limitation lost profits, lost revenue, lost savings, loss of data, replacement costs, or any similar damages, whether based in contract, tort including negligence, strict liability or otherwise, arising from your use of any of the Service or any products procured using the Service, or for any other claim related in any way to your use of the Service or any product.',
        'Because some states or jurisdictions do not allow the exclusion or the limitation of liability for consequential or incidental damages, in such states or jurisdictions, our liability shall be limited to the maximum extent permitted by law.',
      ],
    },
    {
      number: '13',
      title: 'indemnification',
      paragraphs: [
        'You agree to indemnify, defend and hold harmless matsumoto* and our parent, subsidiaries, affiliates, partners, officers, directors, agents, contractors, licensors, Service providers, subcontractors, suppliers, interns and employees, harmless from any claim or demand, including reasonable attorneys fees, made by any third-party due to or arising out of your breach of these Terms of Service or the documents they incorporate by reference, or your violation of any law or the rights of a third-party.',
      ],
    },
    {
      number: '14',
      title: 'severability',
      paragraphs: [
        'In the event that any provision of these Terms of Service is determined to be unlawful, void or unenforceable, such provision shall nonetheless be enforceable to the fullest extent permitted by applicable law, and the unenforceable portion shall be deemed to be severed from these Terms of Service, such determination shall not affect the validity and enforceability of any other remaining provisions.',
      ],
    },
    {
      number: '15',
      title: 'termination',
      paragraphs: [
        'The obligations and liabilities of the parties incurred prior to the termination date shall survive the termination of this agreement for all purposes.',
        'These Terms of Service are effective unless and until terminated by either you or us. You may terminate these Terms of Service at any time by notifying us that you no longer wish to use our Services, or when you cease using our site.',
        'If in our sole judgment you fail, or we suspect that you have failed, to comply with any term or provision of these Terms of Service, we also may terminate this agreement at any time without notice and you will remain liable for all amounts due up to and including the date of termination and/or accordingly may deny you access to our Services or any part thereof.',
      ],
    },
    {
      number: '16',
      title: 'entire agreement',
      paragraphs: [
        'The failure of us to exercise or enforce any right or provision of these Terms of Service shall not constitute a waiver of such right or provision.',
        'These Terms of Service and any policies or operating rules posted by us on this site or in respect to the Service constitutes the entire agreement and understanding between you and us and governs your use of the Service, superseding any prior or contemporaneous agreements, communications and proposals, whether oral or written, between you and us, including but not limited to any prior versions of the Terms of Service.',
        'Any ambiguities in the interpretation of these Terms of Service shall not be construed against the drafting party.',
      ],
    },
    {
      number: '17',
      title: 'governing law',
      paragraphs: [
        'These Terms of Service and any separate agreements whereby we provide you Services shall be governed by and construed in accordance with the laws of United States.',
      ],
    },
    {
      number: '18',
      title: 'changes to terms of service',
      paragraphs: [
        'You can review the most current version of the Terms of Service at any time at this page.',
        'We reserve the right, at our sole discretion, to update, change or replace any part of these Terms of Service by posting updates and changes to our website. It is your responsibility to check our website periodically for changes. Your continued use of or access to our website or the Service following the posting of any changes to these Terms of Service constitutes acceptance of those changes.',
      ],
    },
    {
      number: '19',
      title: 'contact information',
      paragraphs: [
        'Questions about the Terms of Service should be sent to us at jinks@matsumotoshop.com.',
      ],
    },
  ],
}

const privacyPolicyContent = {
  overview: [
    'This Privacy Policy describes how matsumotoshop.com, the Site or we, collects, uses, and discloses your Personal Information when you visit or make a purchase from the Site.',
  ],
  sections: [
    {
      title: 'contact',
      paragraphs: [
        'After reviewing this policy, if you have additional questions, want more information about our privacy practices, or would like to make a complaint, please contact us by email at jinks@matsumotoshop.com.',
      ],
    },
    {
      title: 'collecting personal information',
      paragraphs: [
        'When you visit the Site, we collect certain information about your device, your interaction with the Site, and information necessary to process your purchases. We may also collect additional information if you contact us for customer support.',
        'In this Privacy Policy, we refer to any information about an identifiable individual, including the information below, as Personal Information.',
      ],
      bullets: [
        {
          label: 'Device information',
          points: [
            'Purpose of collection: to load the Site accurately for you, and to perform analytics on Site usage to optimize our Site.',
            'Source of collection: collected automatically when you access our Site using cookies, log files, web beacons, tags, or pixels.',
            'Disclosure for a business purpose: shared with our processor Stripe.',
            'Personal Information collected: version of web browser, IP address, time zone, cookie information, what sites or products you view, search terms, and how you interact with the Site.',
          ],
        },
        {
          label: 'Order information',
          points: [
            'Purpose of collection: to provide products or services to you to fulfill our contract, to process your payment information, arrange for shipping, provide invoices and order confirmations, communicate with you, screen our orders for potential risk or fraud, and when in line with the preferences you have shared with us, provide you with information or advertising relating to our products or services.',
            'Source of collection: collected from you.',
            'Disclosure for a business purpose: shared with our processor Stripe and shipping provider USPS.',
            'Personal Information collected: full name, billing address, shipping address, payment information, including credit card numbers, Cash App Pay, direct-to-bank, Affirm, Klarna, and Amazon Pay, email address, and phone number.',
          ],
        },
        {
          label: 'Customer support information',
          points: [
            'Purpose of collection: to support you, or to use the given information to contact you if needed.',
            'Source of collection: all information is collected via email sent by the customer.',
            'Disclosure for a business purpose: no third-party services will have access to this information.',
            'Personal Information collected: email address and product concerns.',
          ],
        },
      ],
    },
    {
      title: 'minors',
      paragraphs: [
        'The Site is not intended for individuals under the age of 18. We do not intentionally collect Personal Information from children. If you are the parent or guardian and believe your child has provided us with Personal Information, please contact us at the e-mail address above to request deletion.',
      ],
    },
    {
      title: 'sharing personal information',
      paragraphs: [
        'We share your Personal Information with service providers to help us provide our services and fulfill our contracts with you, as described above.',
      ],
      bullets: [
        {
          label: 'Examples',
          points: [
            'We use Stripe to power our online store. You can read more about how Stripe uses your Personal Information here: https://stripe.com/privacy.',
            'We may share your Personal Information to comply with applicable laws and regulations, to respond to a subpoena, search warrant, or other lawful request for information we receive, or to otherwise protect our rights.',
          ],
        },
      ],
    },
    {
      title: 'using personal information',
      paragraphs: [
        'We use your Personal Information to provide our services to you, which includes offering products for sale, processing payments, shipping and fulfillment of your order, and keeping you up to date on new products, services, and offers.',
        'In addition, you agree to our Messaging Privacy Policy.',
      ],
      links: [
        { label: 'Open Messaging Privacy Policy', href: '/messaging-service-privacy-policy' },
      ],
    },
    {
      title: 'lawful basis',
      paragraphs: [
        'Pursuant to the General Data Protection Regulation, GDPR, if you are a resident of the European Economic Area, EEA, we process your personal information under the following lawful bases:',
      ],
      bullets: [
        {
          label: 'Lawful bases',
          points: [
            'Your consent.',
            'The performance of the contract between you and the Site.',
            'Compliance with our legal obligations.',
            'To protect your vital interests.',
            'To perform a task carried out in the public interest.',
            'For our legitimate interests, which do not override your fundamental rights and freedoms.',
          ],
        },
      ],
    },
    {
      title: 'retention',
      paragraphs: [
        "When you place an order through the Site, we will retain your Personal Information for our records unless and until you ask us to erase this information. For more information on your right of erasure, please see the 'Your rights' section below.",
      ],
    },
    {
      title: 'automatic decision-making',
      paragraphs: [
        'If you are a resident of the EEA, you have the right to object to processing based solely on automated decision-making, which includes profiling, when that decision-making has a legal effect on you or otherwise significantly affects you.',
        'We do not engage in fully automated decision-making that has a legal or otherwise significant effect using customer data.',
        'Services that include elements of automated decision-making include:',
      ],
      bullets: [
        {
          label: 'Included services',
          points: [
            'Temporary blacklist of IP addresses associated with repeated failed transactions. This blacklist persists for a small number of hours.',
            'Temporary blacklist of credit cards associated with blacklisted IP addresses. This blacklist persists for a small number of days.',
          ],
        },
      ],
    },
    {
      title: 'selling personal information',
      paragraphs: [
        'Our Site does not sell personal information.',
      ],
    },
    {
      title: 'your rights',
      paragraphs: [
        'GDPR: If you are a resident of the EEA, you have the right to access the Personal Information we hold about you, to port it to a new service, and to ask that your Personal Information be corrected, updated, or erased. If you would like to exercise these rights, please contact us through the contact information above.',
        'Your Personal Information will be initially processed in Ireland and then will be transferred outside of Europe for storage and further processing, including to Canada and the United States.',
      ],
    },
    {
      title: 'cookies',
      paragraphs: [
        'A cookie is a small amount of information that is downloaded to your computer or device when you visit our Site. We use a number of different cookies, including functional, performance, advertising, and social media or content cookies.',
        'Cookies make your browsing experience better by allowing the website to remember your actions and preferences, such as login and region selection. This means you do not have to re-enter this information each time you return to the site or browse from one page to another.',
        'Cookies also provide information on how people use the website, for instance whether it is their first time visiting or if they are a frequent visitor.',
        'We use cookies to optimize your experience on our Site and to provide our services.',
        'A comprehensive list of the cookies we use can be found here: https://stripe.com/cookie-settings.',
        'The length of time that a cookie remains on your computer or mobile device depends on whether it is a persistent or session cookie. Session cookies last until you stop browsing and persistent cookies last until they expire or are deleted. Most of the cookies we use are persistent and will expire between 30 minutes and two years from the date they are downloaded to your device.',
        'You can control and manage cookies in various ways. Please keep in mind that removing or blocking cookies can negatively impact your user experience and parts of our website may no longer be fully accessible.',
        "Most browsers automatically accept cookies, but you can choose whether or not to accept cookies through your browser controls, often found in your browser's Tools or Preferences menu. For more information on how to modify your browser settings or how to block, manage or filter cookies can be found in your browser help file or through sites such as www.allaboutcookies.org.",
        'Additionally, please note that blocking cookies may not completely prevent how we share information with third parties such as our advertising partners.',
      ],
    },
    {
      title: 'do not track',
      paragraphs: [
        'Please note that because there is no consistent industry understanding of how to respond to Do Not Track signals, we do not alter our data collection and usage practices when we detect such a signal from your browser.',
      ],
    },
    {
      title: 'changes',
      paragraphs: [
        'We may update this Privacy Policy from time to time in order to reflect, for example, changes to our practices or for other operational, legal, or regulatory reasons.',
      ],
    },
    {
      title: 'complaints',
      paragraphs: [
        'If you would like to make a complaint, please contact us by email using the details provided under Contact above.',
        'If you are not satisfied with our response to your complaint, you have the right to lodge your complaint with the relevant data protection authority. You can contact your local data protection authority, or our supervisory authority here: https://www.dataprivacyframework.gov/Data-Protection-Authorities.',
      ],
    },
  ],
  lastUpdated: 'Last updated: 7/31/2026',
}

const messagingPrivacyPolicyContent = {
  overview: [
    'This Messaging Service Privacy Policy explains how matsumoto* collects, uses, and shares personal information about you in relation to our e-mail marketing program, the Messaging Service. This Messaging Service Privacy Policy supplements our Primary Privacy Policy.',
  ],
  sections: [
    {
      title: "changes to the messaging service privacy policy",
      paragraphs: [
        "We may revise this Messaging Service Privacy Policy from time to time in our sole discretion. If there are any material changes to this Messaging Service Privacy Policy, we will notify you as required by applicable law.",
        "You understand and agree that you will be deemed to have accepted the updated Messaging Service Privacy Policy if you continue to use the Messaging Service after the new Messaging Service Privacy Policy takes effect.",
      ],
    },
    {
      title: "personal information we collect",
      paragraphs: [
        "When you sign up for the Messaging Service, we collect personal information such as your name, email address, and other information you provide directly to us, for example responses to questionnaires about your preferences or demographic information.",
        "When you use the Messaging Service to send or receive messages, we collect communications metadata, for example the time and date a message was sent or received, and the contents of any communications you send or receive via the Messaging Service.",
        "We may also collect information about you using cookies or similar technologies on our website or other digital properties. Cookies are small text files placed on device browsers that store preferences and facilitate and enhance your experience.",
        "Cookies enable personalization of your experience via the Messaging Service, for example sending you personalized text messages such as shopping cart reminders.",
        "If you participate in an email survey, or order with us, we will collect basic contact information and any other information you choose to provide in connection with these activities. We will also collect your personal information if you contact us with questions about the Messaging Service or for customer service.",
      ],
    },
    {
      title: "use of personal information",
      paragraphs: [
        "We use your information to deliver, analyze, maintain and support the Messaging Service.",
        "We may also use your information to enhance the Messaging Service features and customize and personalize your experiences on the Messaging Service.",
        "We may use your personal information to generate aggregated and or de-identified information. Aggregated and or de-identified information is not personal information and may be shared with any third party, including advertisers, promotional partners, and sponsors.",
      ],
    },
  ],
}

const policyPages = {
  '/tos': {
    eyebrow: 'terms of service',
    title: 'terms of service',
    intro:
      'Use this page for the rules, purchase terms, store limitations, and general conditions that govern use of matsumotoshop.com.',
    sections: [
      {
        kicker: 'store use',
        title: 'Site access and product information',
        copy:
          'Use this section for general site-use terms, product display limitations, availability language, and any right to update or remove products.',
      },
      {
        kicker: 'orders',
        title: 'Payments, fulfillment, and cancellations',
        copy:
          'Use this block for checkout terms, accepted payment methods, order acceptance language, cancellation limits, and fulfillment timing.',
      },
      {
        kicker: 'liability',
        title: 'Disclaimers and limitations',
        copy:
          'Use this section for standard warranty disclaimers, limitation-of-liability language, and any governing-law or dispute provisions you adopt.',
      },
    ],
    noteLabel: 'next step',
    noteTitle: 'Replace placeholder language with your final legal copy.',
    noteCopy:
      'This route is ready for your final terms once you finish the legal text. Keep the structure, then swap in the approved wording.',
  },
  '/privacy-policy': {
    eyebrow: 'privacy policy',
    title: 'privacy policy',
    intro:
      'Use this page to explain what customer information the store collects, how it is used, who processes it, and how people can reach you about privacy questions.',
    sections: [
      {
        kicker: 'collection',
        title: 'What information the store collects',
        copy:
          'Use this section for contact details, order information, payment-related metadata, device data, analytics, and any marketing opt-in data you collect.',
      },
      {
        kicker: 'use',
        title: 'How information is used',
        copy:
          'Use this block for order fulfillment, support, fraud prevention, analytics, account communication, and any marketing or retention logic you apply.',
      },
      {
        kicker: 'sharing',
        title: 'Third-party processors and customer rights',
        copy:
          'Use this section for Stripe, hosting, email or messaging vendors, data retention, rights requests, and contact instructions for privacy questions.',
      },
    ],
    noteLabel: 'messaging',
    noteTitle: 'Messaging privacy policy',
    noteCopy:
      'If you send SMS or messaging-based updates, link that separate policy here instead of placing it in the footer.',
    noteLink: {
      label: 'Open messaging privacy policy',
      href: '/messaging-service-privacy-policy',
    },
  },
  '/refunds': {
    eyebrow: 'refund policy',
    title: 'refund policy',
    intro:
      'We thank you very much for your purchase.',
    sections: [
      {
        kicker: 'refunds',
        title: 'Refund requests',
        copy:
          "If you'd like a refund, please send information about any defects or dissatisfaction in the service.",
      },
      {
        kicker: 'store credit',
        title: 'Resolution',
        copy:
          'Depending on the situation, store credit may be administered.',
      },
    ],
    noteLabel: 'support',
    noteTitle: 'Send refund questions to the store inbox.',
    noteCopy:
      'For refund questions or order issues, contact jinks@matsumotoshop.com.',
  },
  '/messaging-service-privacy-policy': {
    eyebrow: 'messaging privacy',
    title: 'messaging service privacy policy',
    intro:
      'This Messaging Service Privacy Policy explains how matsumoto* collects, uses, and shares personal information about you in relation to our e-mail marketing program, the Messaging Service. This Messaging Service Privacy Policy supplements our Primary Privacy Policy.',
    sections: [
      {
        kicker: 'changes',
        title: 'Changes and personal information we collect',
        copy:
          'We may revise this Messaging Service Privacy Policy from time to time in our sole discretion. When you sign up for the Messaging Service, use it, participate in an email survey, place an order, or contact us for customer care, we may collect personal information such as your name, email address, communications metadata, message contents, preferences, and other information you provide directly to us.',
      },
      {
        kicker: 'data use',
        title: 'How messaging information is used',
        copy:
          'We use your information to deliver, analyze, maintain, and support the Messaging Service, enhance features, and customize your experience. We may also use cookies or similar technologies to personalize messaging experiences, such as shopping cart reminders, and we may generate aggregated or de-identified information that is not personal information and may be shared with third parties.',
      },
      {
        kicker: 'care',
        title: 'Accurate information, customer care, and supplemental notices',
        copy:
          'When you provide information in connection with the Messaging Service, you agree to provide accurate, complete, and true information. If you experience problems with the Messaging Service, please email jinks@matsumotoshop.com. This page also includes the supplemental Utah Privacy Notice effective March 27, 2025 and states that by signing up to receive text messages from us, you also agree to our Primary Privacy Policy.',
      },
    ],
    noteLabel: 'privacy',
    noteTitle: 'primary privacy policy',
    noteCopy:
      'By signing up to receive text messages from us, you also agree to our Primary Privacy Policy. This Messaging Service Privacy Policy is strictly limited to the Messaging Service and does not limit or restrict any other privacy policies that may govern the relationship between you and us in other contexts.',
    noteLink: {
      label: 'Open Privacy Policy',
      href: '/privacy-policy',
    },
  },
}

const footerPrimaryLinks = [
  { label: 'contact', href: '/contact' },
  { label: 'FAQ', href: '/faq' },
  { label: 'about', href: '/about' },
]

const footerPolicyLinks = [
  { label: 'refund policy', href: '/refunds' },
  { label: 'terms of service', href: '/tos' },
  { label: 'privacy policy', href: '/privacy-policy' },
]

const COLOR_OPTIONS = ['black', 'white', 'ash-grey']
const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL']
const CART_STORAGE_KEY = 'matsumoto_cart_v1'

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function defaultProductTypeForCategory(category) {
  if (category === '/bottoms') {
    return 'bottoms'
  }

  if (category === '/other-merchandise') {
    return 'merch'
  }

  return 'shirt'
}

function defaultAllowedSizesForProductType(productType) {
  return productType === 'merch' ? [] : [...SIZE_OPTIONS]
}

function defaultColorsForProductType(productType) {
  if (productType === 'shirt') {
    return [...COLOR_OPTIONS]
  }

  if (productType === 'bottoms') {
    return ['black']
  }

  return []
}

function defaultInventoryScopeForProductType(productType) {
  return productType === 'shirt' ? 'shared-shirt' : 'untracked'
}

function normalizeCatalogProduct(product, category, index) {
  const productType = product.productType || defaultProductTypeForCategory(category)
  const baseSlug = product.slug || slugify(`${category.replace('/', '')}-${product.name}-${index + 1}`)

  return {
    ...product,
    id: product.id || `${category}-${baseSlug}`,
    category: product.category || category,
    slug: baseSlug,
    active: product.active !== false,
    productType,
    inventoryScope: product.inventoryScope || defaultInventoryScopeForProductType(productType),
    allowedSizes:
      Array.isArray(product.allowedSizes) && product.allowedSizes.length
        ? product.allowedSizes
        : defaultAllowedSizesForProductType(productType),
    colors:
      Array.isArray(product.colors) && product.colors.length
        ? product.colors
        : defaultColorsForProductType(productType),
    images: Array.isArray(product.images) ? product.images : [],
    type: product.type || 'placeholder',
  }
}

function readCartStorage() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const rawCart = window.localStorage.getItem(CART_STORAGE_KEY)
    const parsedCart = rawCart ? JSON.parse(rawCart) : []
    return Array.isArray(parsedCart) ? parsedCart : []
  } catch {
    return []
  }
}

function cartItemKey(item) {
  return [item.productId, item.color || 'no-color', item.size || 'no-size'].join('::')
}

function cartUnitPrice(item) {
  return item.hasDeal && item.salePrice ? item.salePrice : item.price
}

function getAvailableQuantity(product, shirtInventory, color, size) {
  if (product.inventoryScope !== 'shared-shirt') {
    return null
  }

  if (!color || !size) {
    return null
  }

  return Number(shirtInventory?.[color]?.[size] ?? 0)
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function formatCategoryLabel(pathname) {
  return merchCategoryLinks.find((link) => link.href === pathname)?.label ?? 'store item'
}

function buildCollectionItems(customProducts, collectionKey, fallbackItems) {
  const collectionProducts = customProducts.filter(
    (product) =>
      product.active !== false &&
      (collectionKey === 'addToFeaturedCollection'
        ? Boolean(product.addToFeaturedCollection ?? product.addToCollection)
        : Boolean(product[collectionKey])),
  )

  if (!collectionProducts.length) {
    return fallbackItems
  }

  return collectionProducts.slice(0, 3).map((product, index) => ({
    eyebrow: `featured item ${String(index + 1).padStart(2, '0')}`,
    title: product.name,
    href: product.slug ? `/products/${product.slug}` : null,
    price: product.hasDeal && product.salePrice
      ? `${formatCurrency(product.salePrice)} sale`
      : formatCurrency(product.price),
    copy: product.description,
    image: product.images?.[0] || '/tee-mockup.png',
    accent: formatCategoryLabel(product.category),
  }))
}

function fallbackCardsForCategory(pathname) {
  return (merchPageContent[pathname]?.cards ?? []).map((product, index) =>
    normalizeCatalogProduct(product, pathname, index),
  )
}

function categoryCards(pathname, customProducts) {
  const uploadedProducts = customProducts.filter(
    (product) => product.active !== false && product.category === pathname,
  )

  if (uploadedProducts.length) {
    return uploadedProducts
  }

  return fallbackCardsForCategory(pathname)
}

function buildStoreCatalog(customProducts) {
  return merchCategoryLinks.flatMap((link) => categoryCards(link.href, customProducts))
}

function productSlugFromPath(pathname) {
  const match = pathname.match(/^\/products\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

function normalizePath(pathname) {
  if (!pathname || pathname === '/') {
    return '/'
  }

  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function shouldHandleClientNav(event) {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
}

function mapTitle() {
  return (
    <>
      follow the{' '}
      <span className="map-word">
        map
        <img
          className="map-word-mark"
          src="/network-hub-asterisk.png"
          alt=""
          aria-hidden="true"
        />
      </span>
    </>
  )
}

function FeaturedCarousel({ featuredItems, utahItems, onNavigate }) {
  const tickerTrackRef = useRef(null)
  const tickerGroupRef = useRef(null)

  useEffect(() => {
    if (!tickerTrackRef.current || !tickerGroupRef.current) {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    if (mediaQuery.matches) {
      tickerTrackRef.current.style.transform = 'translate3d(0, 0, 0)'
      return undefined
    }

    let animationFrameId = 0
    let lastFrameTime = 0
    let loopWidth = 0
    let offset = 0
    const speed = 42

    const updateTickerWidth = () => {
      loopWidth = tickerGroupRef.current.getBoundingClientRect().width

      if (!loopWidth) {
        return
      }

      offset = ((offset % loopWidth) + loopWidth) % loopWidth
      tickerTrackRef.current.style.transform = `translate3d(${-offset}px, 0, 0)`
    }

    const stepTicker = (time) => {
      if (!lastFrameTime) {
        lastFrameTime = time
      }

      const delta = time - lastFrameTime
      lastFrameTime = time

      if (loopWidth > 0) {
        offset += (speed * delta) / 1000

        if (offset >= loopWidth) {
          offset -= loopWidth
        }

        tickerTrackRef.current.style.transform = `translate3d(${-offset}px, 0, 0)`
      }

      animationFrameId = window.requestAnimationFrame(stepTicker)
    }

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateTickerWidth)
    } else {
      const resizeObserver = new ResizeObserver(updateTickerWidth)
      resizeObserver.observe(tickerGroupRef.current)

      updateTickerWidth()
      animationFrameId = window.requestAnimationFrame(stepTicker)

      return () => {
        window.cancelAnimationFrame(animationFrameId)
        resizeObserver.disconnect()
      }
    }

    updateTickerWidth()
    animationFrameId = window.requestAnimationFrame(stepTicker)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', updateTickerWidth)
    }
  }, [])

  return (
    <section className="featured-band" aria-labelledby="featured-items-heading">
      <div className="featured-ticker" aria-hidden="true">
        <div className="featured-ticker-track" ref={tickerTrackRef}>
          {[0, 1].map((groupIndex) => (
            <div
              className="featured-ticker-group"
              key={groupIndex}
              ref={groupIndex === 0 ? tickerGroupRef : undefined}
            >
              {tickerLoopItems.map((item, itemIndex) => (
                <span key={`${groupIndex}-${item}-${itemIndex}`}>{item}</span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="featured-carousel">
        <div className="featured-carousel-copy">
          <h2 id="utah-local-collection-heading">utah local collection</h2>
        </div>

        <LiquidGlassCarouselSection
          title="utah local collection"
          headingId="utah-local-collection-heading"
          items={utahItems}
          onNavigate={onNavigate}
        />
      </div>

      <div className="featured-carousel">
        <div className="featured-carousel-copy">
          <h2 id="featured-items-heading">collection preview</h2>
        </div>

        <div className="featured-carousel-stage">
          <div className="featured-rail">
            {featuredItems.map((item) => (
              item.href ? (
                <a
                  key={item.title}
                  className="featured-card-link"
                  href={item.href}
                  onClick={(event) => onNavigate(event, item.href)}
                >
                  <article className="featured-card">
                    <div className="featured-card-image">
                      <img src={item.image} alt={item.title} />
                    </div>

                    <div className="featured-card-content">
                      <p className="featured-slide-kicker">{item.eyebrow}</p>
                      <div className="featured-slide-heading">
                        <h3>{item.title}</h3>
                        <span>{item.price}</span>
                      </div>
                      <p>{item.copy}</p>
                      <span className="featured-accent">{item.accent}</span>
                    </div>
                  </article>
                </a>
              ) : (
                <article key={item.title} className="featured-card">
                  <div className="featured-card-image">
                    <img src={item.image} alt={item.title} />
                  </div>

                  <div className="featured-card-content">
                    <p className="featured-slide-kicker">{item.eyebrow}</p>
                    <div className="featured-slide-heading">
                      <h3>{item.title}</h3>
                      <span>{item.price}</span>
                    </div>
                    <p>{item.copy}</p>
                    <span className="featured-accent">{item.accent}</span>
                  </div>
                </article>
              )
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function MapHome({ featuredItems, utahItems, onNavigate }) {
  return (
    <>
      <section className="network-section" id="home">
        <div className="network-copy">
          <p className="eyebrow">browse the store</p>
          <h1>{mapTitle()}</h1>
        </div>

        <div className="network-map" aria-label="Category map">
          <img
            className="network-map-image"
            src="/matsumoto-map-new.png"
            alt=""
            aria-hidden="true"
          />

          {categoryLinks.map((link) => (
            <a
              key={link.id}
              className={`map-stop ${link.nodeClassName}`}
              href={link.href}
              onClick={(event) => onNavigate(event, link.href)}
            >
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <FeaturedCarousel
        featuredItems={featuredItems}
        utahItems={utahItems}
        onNavigate={onNavigate}
      />
    </>
  )
}

function CategoryPage({ content, onNavigate }) {
  return (
    <>
      <section className="featured-section shop-section page-template">
        <div className="section-heading">
          <p className="eyebrow">{content.eyebrow}</p>
          <h2>{content.title}</h2>
          <p>{content.intro}</p>
        </div>

        <div className="page-link-row">
          <a
            className="button button-secondary"
            href="/"
            onClick={(event) => onNavigate(event, '/')}
          >
            Back to map
          </a>
          <a
            className="button button-primary"
            href="/contact"
            onClick={(event) => onNavigate(event, '/contact')}
          >
            Contact the store
          </a>
        </div>

        <div className="product-grid">
          {content.cards.map((product) => (
            <ProductCard
              key={`${content.title}-${product.slug || product.name}`}
              product={product}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </section>

      <section className="category-rail">
        {content.details.map((detail) => (
          <article className="category-panel" key={`${content.title}-${detail.title}`}>
            <p className="eyebrow">{detail.kicker}</p>
            <h3>{detail.title}</h3>
            <p>{detail.copy}</p>
          </article>
        ))}
      </section>
    </>
  )
}

function ProductPage({ product, shirtInventory, cartCount, onAddToCart, onNavigate }) {
  const [selectedColor, setSelectedColor] = useState(product.colors?.[0] || '')
  const [selectedSize, setSelectedSize] = useState(product.allowedSizes?.[0] || '')
  const [quantity, setQuantity] = useState(1)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setSelectedColor(product.colors?.[0] || '')
    setSelectedSize(product.allowedSizes?.[0] || '')
    setQuantity(1)
    setMessage('')
  }, [product.id])

  const primaryImage = product.images?.[0] || '/tee-mockup.png'
  const secondaryImage = product.images?.[1] || primaryImage || '/tee-mockup-hover.jpg'
  const availableQuantity = getAvailableQuantity(product, shirtInventory, selectedColor, selectedSize)
  const maxQuantity = availableQuantity === null ? 10 : Math.max(availableQuantity, 1)
  const isOutOfStock = availableQuantity !== null && availableQuantity <= 0
  const requiresColor = product.colors.length > 0
  const requiresSize = product.allowedSizes.length > 0
  const displayPrice = cartUnitPrice(product)

  const handleAddToCart = (event) => {
    event.preventDefault()

    if (requiresColor && !selectedColor) {
      setMessage('Choose a color first.')
      return
    }

    if (requiresSize && !selectedSize) {
      setMessage('Choose a size first.')
      return
    }

    if (isOutOfStock) {
      setMessage('That combination is out of stock.')
      return
    }

    const normalizedQuantity = Math.min(Math.max(1, Number(quantity) || 1), maxQuantity)

    onAddToCart({
      product,
      color: selectedColor || null,
      size: selectedSize || null,
      quantity: normalizedQuantity,
    })
    setQuantity(1)
    setMessage(`${product.name} added to cart.`)
  }

  return (
    <section className="featured-section shop-section page-template product-page">
      <div className="product-page-grid">
        <div className="product-gallery-card">
          <div className="product-page-image product-page-image-primary">
            <img src={primaryImage} alt={product.name} />
          </div>
          <div className="product-page-image product-page-image-secondary">
            <img src={secondaryImage} alt="" aria-hidden="true" />
          </div>
        </div>

        <div className="product-page-copy">
          <p className="eyebrow">{formatCategoryLabel(product.category)}</p>
          <h2>{product.name}</h2>
          <p>{product.description}</p>

          <div className="product-page-price">
            {product.hasDeal && product.salePrice ? (
              <>
                <strong>{formatCurrency(product.salePrice)}</strong>
                <small>{formatCurrency(product.price)}</small>
              </>
            ) : (
              <strong>{formatCurrency(displayPrice)}</strong>
            )}
          </div>

          <form className="product-form" onSubmit={handleAddToCart}>
            {requiresColor ? (
              <fieldset className="product-option-group">
                <legend>Color</legend>
                <div className="product-chip-list">
                  {product.colors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`product-chip ${selectedColor === color ? 'is-active' : ''}`}
                      onClick={() => setSelectedColor(color)}
                    >
                      {color.replace('-', ' ')}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {requiresSize ? (
              <fieldset className="product-option-group">
                <legend>Size</legend>
                <div className="product-chip-list">
                  {product.allowedSizes.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`product-chip ${selectedSize === size ? 'is-active' : ''}`}
                      onClick={() => setSelectedSize(size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <label className="product-quantity-field">
              <span>Quantity</span>
              <input
                type="number"
                min="1"
                max={maxQuantity}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>

            <p className="product-stock-note">
              {availableQuantity === null
                ? product.inventoryScope === 'shared-shirt'
                  ? 'Shared shirt stock will be confirmed once color and size are selected.'
                  : 'Inventory for this item is not tracked yet.'
                : `${availableQuantity} available in the shared shirt stock pool.`}
            </p>

            {message ? <p className="dev-form-success">{message}</p> : null}

            <div className="product-page-actions">
              <button className="button button-primary" type="submit" disabled={isOutOfStock}>
                {isOutOfStock ? 'Out of stock' : 'Add to cart'}
              </button>
              <a
                className="button button-secondary"
                href="/cart"
                onClick={(event) => onNavigate(event, '/cart')}
              >
                View cart ({cartCount})
              </a>
              <a
                className="button button-secondary"
                href={product.category}
                onClick={(event) => onNavigate(event, product.category)}
              >
                Back to category
              </a>
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

function CartPage({ cart, shirtInventory, onNavigate, onRemoveFromCart, onUpdateCartQuantity }) {
  const subtotal = cart.reduce((sum, item) => sum + cartUnitPrice(item) * item.quantity, 0)
  const orderSummary = buildEstimatedOrderSummary(Math.round(subtotal * 100))

  if (!cart.length) {
    return (
      <section className="notes-section route-section cart-empty-state">
        <div className="notes-copy cart-empty-copy">
          <h2 className="cart-empty-title">your cart is empty.</h2>
          <p>add a product from any category page to start building your order.</p>
          <a
            className="button button-primary notes-button"
            href="/tees"
            onClick={(event) => onNavigate(event, '/tees')}
          >
            Browse tees
          </a>
        </div>
      </section>
    )
  }

  return (
    <section className="featured-section shop-section page-template cart-page">
      <div className="section-heading">
        <h2>review the order</h2>
        <p>Adjust quantities here before moving into checkout.</p>
      </div>

      <div className="cart-layout">
        <div className={`cart-list${cart.length === 1 ? ' cart-list-single' : ''}`}>
          {cart.map((item) => {
            const availableQuantity = getAvailableQuantity(
              item,
              shirtInventory,
              item.color,
              item.size,
            )

            return (
              <article className="cart-item" key={item.key}>
                <img src={item.image} alt={item.name} className="cart-item-image" />

                <div className="cart-item-copy">
                  <div className="cart-item-heading">
                    <h3>{item.name}</h3>
                    <strong>{formatCurrency(cartUnitPrice(item) * item.quantity)}</strong>
                  </div>
                  <p className="cart-item-meta">
                    {[item.color?.replace('-', ' '), item.size].filter(Boolean).join(' • ')}
                  </p>
                  {availableQuantity !== null ? (
                    <p className="cart-item-stock">{availableQuantity} currently available in shared stock.</p>
                  ) : (
                    <p className="cart-item-stock">Inventory is not tracked yet for this item.</p>
                  )}

                  <div className="cart-item-actions">
                    <label className="product-quantity-field">
                      <span>Qty</span>
                      <input
                        type="number"
                        min="1"
                        max={availableQuantity === null ? 10 : Math.max(availableQuantity, 1)}
                        value={item.quantity}
                        onChange={(event) =>
                          onUpdateCartQuantity(
                            item.key,
                            Math.max(1, Number(event.target.value) || 1),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => onRemoveFromCart(item.key)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        <aside className="newsletter-card cart-summary">
          <p className="panel-label">summary</p>
          <h3>{formatCurrency(orderSummary.totalCents / 100)}</h3>
          <div className="order-summary-breakdown">
            <div className="order-summary-row">
              <span>Subtotal</span>
              <strong>{formatCurrency(orderSummary.subtotalCents / 100)}</strong>
            </div>
            <div className="order-summary-row">
              <span>
                {orderSummary.shippingCents === 0 ? 'Free domestic shipping' : 'Standard shipping'}
              </span>
              <strong>{formatCurrency(orderSummary.shippingCents / 100)}</strong>
            </div>
            <div className="order-summary-row">
              <span>Estimated tax (7.25%)</span>
              <strong>{formatCurrency(orderSummary.taxCents / 100)}</strong>
            </div>
            <div className="order-summary-row order-summary-row-total">
              <span>Total</span>
              <strong>{formatCurrency(orderSummary.totalCents / 100)}</strong>
            </div>
          </div>
          <p>
            Standard shipping is free over {formatCurrency(FREE_SHIPPING_THRESHOLD_CENTS / 100)}.
            Shipping can still change if a different rate is selected in checkout.
          </p>
          <div className="cart-summary-actions">
            <a
              className="button button-primary"
              href="/checkout"
              onClick={(event) => onNavigate(event, '/checkout')}
            >
              Continue to checkout
            </a>
            <a
              className="button button-secondary"
              href="/tees"
              onClick={(event) => onNavigate(event, '/tees')}
            >
              Keep shopping
            </a>
          </div>
        </aside>
      </div>
    </section>
  )
}

function ProductMissingPage({ onNavigate }) {
  return (
    <section className="notes-section route-section">
      <div className="notes-copy">
        <p className="eyebrow">product</p>
        <h2>item not found.</h2>
        <p>The product route does not match any live or fallback catalog entry.</p>
        <a
          className="button button-primary notes-button"
          href="/"
          onClick={(event) => onNavigate(event, '/')}
        >
          Return to map
        </a>
      </div>

      <div className="newsletter-card">
        <p className="panel-label">catalog</p>
        <h3>Check the live category pages.</h3>
        <p>If this route used to exist, the product may have been unpublished or renamed.</p>
      </div>
    </section>
  )
}

function AboutPage({ onNavigate }) {
  return (
    <>
      <section className="story-section route-section">
        <div className="story-card">
          <p className="eyebrow">about</p>
          <h2>{aboutContent.title}</h2>
          <p>{aboutContent.intro}</p>
          <a
            className="button button-secondary story-button"
            href="/"
            onClick={(event) => onNavigate(event, '/')}
          >
            Back to map
          </a>
        </div>

        <div className="story-list">
          {aboutContent.points.map((point) => (
            <article key={point.title}>
              <span>{point.kicker}</span>
              <h3>{point.title}</h3>
              <p>{point.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="notes-section route-section">
        <div className="notes-copy">
          <p className="eyebrow">brand notes</p>
          <h2>what belongs here later.</h2>
          <ul className="notes-list">
            {aboutContent.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>

        <div className="newsletter-card">
          <p className="panel-label">next step</p>
          <h3>Translate the real story into this structure.</h3>
          <p>
            Once the brand language is settled, this page can become more
            specific without changing the overall system of the site.
          </p>
        </div>
      </section>
    </>
  )
}

function ContactPage({ onNavigate }) {
  return (
    <>
      <section className="notes-section route-section">
        <div className="notes-copy">
          <p className="eyebrow">contact</p>
          <h2>{contactContent.title}</h2>
          <p>{contactContent.intro}</p>
          <a
            className="button button-secondary notes-button"
            href="/"
            onClick={(event) => onNavigate(event, '/')}
          >
            Back to map
          </a>
        </div>

        <div className="newsletter-card">
          <p className="panel-label">email</p>
          <h3>jinks@matsumotoshop.com</h3>
          <a className="button button-primary" href="mailto:jinks@matsumotoshop.com">
            Email the store
          </a>
        </div>
      </section>

      <section className="category-rail">
        {contactContent.panels.map((panel) => (
          <article className="category-panel" key={panel.title}>
            <p className="eyebrow">{panel.kicker}</p>
            <h3>{panel.title}</h3>
            <p>{panel.copy}</p>
          </article>
        ))}
      </section>
    </>
  )
}

function FaqPage({ onNavigate }) {
  return (
    <>
      <section className="notes-section route-section">
        <div className="notes-copy">
          <p className="eyebrow">FAQ</p>
          <h2>common questions.</h2>
          <p>
            A placeholder page for shipping, sizing, returns, and the usual
            store questions that are better answered before checkout.
          </p>
          <a
            className="button button-secondary notes-button"
            href="/"
            onClick={(event) => onNavigate(event, '/')}
          >
            Back to map
          </a>
        </div>

        <div className="newsletter-card">
          <p className="panel-label">support note</p>
          <h3>Keep answers direct.</h3>
          <p>
            This page should stay functional and short. Good FAQ pages reduce
            support email without feeling like policy paperwork.
          </p>
        </div>
      </section>

      <section className="category-rail">
        {faqContent.map((item) => (
          <article className="category-panel" key={item.title}>
            <p className="eyebrow">{item.kicker}</p>
            <h3>{item.title}</h3>
            <p>{item.copy}</p>
          </article>
        ))}
      </section>
    </>
  )
}

function TermsPage({ onNavigate }) {
  return (
    <>
      <section className="notes-section route-section terms-overview-section">
        <div className="notes-copy">
          <h2>terms of service</h2>
          {termsOfServiceContent.overview.map((paragraph) => (
            <p
              key={paragraph}
              className="terms-overview-paragraph-break"
            >
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      <section className="legal-section-list route-section">
        {termsOfServiceContent.sections.map((section) => (
          <article className="legal-section-card" key={section.number}>
            <p className="eyebrow">
              section {section.number}
            </p>
            <h3>{section.title}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.links ? (
              <div className="legal-section-links">
                {section.links.map((link) => (
                  <a
                    key={link.href}
                    className="button button-secondary"
                    href={link.href}
                    onClick={(event) => onNavigate(event, link.href)}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className="notes-section route-section terms-contact-section">
        <div className="newsletter-card terms-contact-card">
          <h3>Questions about these terms?</h3>
          <div className="terms-contact-row">
            <p className="terms-contact-copy">
              Questions about the Terms of Service should be sent to jinks@matsumotoshop.com.
            </p>
            <a className="button button-primary terms-contact-button" href="mailto:jinks@matsumotoshop.com">
              Email the store
            </a>
          </div>
        </div>
      </section>
    </>
  )
}

function PrivacyPolicyPage({ onNavigate }) {
  return (
    <>
      <section className="notes-section route-section terms-overview-section">
        <div className="notes-copy">
          <h2>privacy policy</h2>
          {privacyPolicyContent.overview.map((paragraph) => (
            <p key={paragraph} className="terms-overview-paragraph-break">
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      <section className="legal-section-list route-section">
        {privacyPolicyContent.sections.map((section, index) => (
          <article className="legal-section-card" key={section.title}>
            <p className="eyebrow">
              section {String(index + 1).padStart(2, '0')}
            </p>
            <h3>{section.title}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.bullets ? (
              <div className="legal-bullet-groups">
                {section.bullets.map((group) => (
                  <div className="legal-bullet-group" key={group.label}>
                    <strong>{group.label}</strong>
                    <ul className="notes-list legal-notes-list">
                      {group.points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
            {section.links ? (
              <div className="legal-section-links">
                {section.links.map((link) => (
                  <a
                    key={link.href}
                    className="button button-secondary"
                    href={link.href}
                    onClick={(event) => onNavigate(event, link.href)}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className="notes-section route-section terms-contact-section">
        <div className="newsletter-card terms-contact-card">
          <h3>{privacyPolicyContent.lastUpdated}</h3>
          <p className="terms-contact-copy">
            Questions or complaints about this Privacy Policy can be sent to jinks@matsumotoshop.com.
          </p>
          <a className="button button-primary terms-contact-button" href="mailto:jinks@matsumotoshop.com">
            Email the store
          </a>
        </div>
      </section>
    </>
  )
}

function MessagingPrivacyPolicyPage({ onNavigate }) {
  const content = policyPages['/messaging-service-privacy-policy']

  return (
    <>
      <section className="notes-section route-section terms-overview-section">
        <div className="notes-copy">
          <h2>{content.title}</h2>
          {messagingPrivacyPolicyContent.overview.map((paragraph) => (
            <p key={paragraph} className="terms-overview-paragraph-break">
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      <section className="legal-section-list route-section">
        {messagingPrivacyPolicyContent.sections.map((section, index) => (
          <article className="legal-section-card" key={section.title}>
            <p className="eyebrow">
              section {String(index + 1).padStart(2, '0')}
            </p>
            <h3>{section.title}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
        ))}
      </section>

      <section className="notes-section route-section terms-contact-section">
        <div className="newsletter-card terms-contact-card messaging-policy-card">
          <h3>{content.noteTitle}</h3>
          <div className="terms-contact-row messaging-policy-row">
            <p className="terms-contact-copy">{content.noteCopy}</p>
            <a
              className="button button-primary terms-contact-button messaging-policy-button"
              href={content.noteLink.href}
              onClick={(event) => onNavigate(event, content.noteLink.href)}
            >
              {content.noteLink.label}
            </a>
          </div>
        </div>
      </section>
    </>
  )
}

function RefundPolicyPage() {
  const content = policyPages['/refunds']
  const refundCopy = [
    content.intro,
    ...content.sections.map((section) => section.copy),
    content.noteCopy,
  ].join(' ')

  return (
    <section className="notes-section route-section terms-overview-section">
      <div className="notes-copy">
        <h2>{content.title}</h2>
        <p className="terms-overview-paragraph-break">{refundCopy}</p>
        <a className="button button-primary notes-button" href="mailto:jinks@matsumotoshop.com">
          Contact the store
        </a>
      </div>
    </section>
  )
}

function PolicyPage({ content, onNavigate }) {
  return (
    <>
      <section className="notes-section route-section">
        <div className="notes-copy">
          <p className="eyebrow">{content.eyebrow}</p>
          <h2>{content.title}</h2>
          <p>{content.intro}</p>
          <a
            className="button button-secondary notes-button"
            href="/"
            onClick={(event) => onNavigate(event, '/')}
          >
            Back to map
          </a>
        </div>

        <div className="newsletter-card">
          <p className="panel-label">{content.noteLabel}</p>
          <h3>{content.noteTitle}</h3>
          <p>{content.noteCopy}</p>
          {content.noteLink ? (
            <a
              className="button button-primary"
              href={content.noteLink.href}
              onClick={(event) => onNavigate(event, content.noteLink.href)}
            >
              {content.noteLink.label}
            </a>
          ) : null}
        </div>
      </section>

      <section className="category-rail">
        {content.sections.map((section) => (
          <article className="category-panel" key={section.title}>
            <p className="eyebrow">{section.kicker}</p>
            <h3>{section.title}</h3>
            <p>{section.copy}</p>
          </article>
        ))}
      </section>
    </>
  )
}

const socialIconSources = {
  instagram: '/social-instagram-v2.png',
  tiktok: '/social-tiktok-transparent.png',
  facebook: '/social-facebook-v2.png',
}

function SocialIcon({ kind }) {
  return <img src={socialIconSources[kind]} alt="" aria-hidden="true" />
}

function AsciiAnimation() {
  return (
    <video
      className="ascii-gif"
      src="/footer-animation.mov"
      aria-label="Looping footer animation"
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
    />
  )
}

function SiteFooter({ onNavigate }) {
  return (
    <footer className="site-footer">
      <div className="footer-column footer-links">
        <div className="footer-link-columns">
          <div className="footer-link-column">
            {footerPrimaryLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={(event) => onNavigate(event, link.href)}
              >
                {link.label}
              </a>
            ))}

            <div className="footer-socials">
              <a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram">
                <SocialIcon kind="instagram" />
              </a>
              <a href="https://tiktok.com" target="_blank" rel="noreferrer" aria-label="TikTok">
                <SocialIcon kind="tiktok" />
              </a>
              <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook">
                <SocialIcon kind="facebook" />
              </a>
            </div>
          </div>

          <div className="footer-link-column footer-link-column-legal">
            {footerPolicyLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={(event) => onNavigate(event, link.href)}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="footer-column footer-ascii">
        <AsciiAnimation />
      </div>
    </footer>
  )
}

function renderPage(
  pathname,
  onNavigate,
  customProducts,
  featuredItems,
  utahItems,
  productCatalog,
  shirtInventory,
  cart,
  onAddToCart,
  onRemoveFromCart,
  onUpdateCartQuantity,
  onCheckoutComplete,
  onSaveProduct,
  onUpdateProduct,
  onDeleteProduct,
  storageError,
) {
  const productSlug = productSlugFromPath(pathname)
  const matchedProduct = productSlug
    ? productCatalog.find((product) => product.slug === productSlug)
    : null

  if (pathname === '/') {
    return <MapHome featuredItems={featuredItems} utahItems={utahItems} onNavigate={onNavigate} />
  }

  if (pathname === '/cart') {
    return (
      <CartPage
        cart={cart}
        shirtInventory={shirtInventory}
        onNavigate={onNavigate}
        onRemoveFromCart={onRemoveFromCart}
        onUpdateCartQuantity={onUpdateCartQuantity}
      />
    )
  }

  if (pathname === '/checkout') {
    return (
      <CheckoutPage
        cart={cart}
        onNavigate={onNavigate}
        onCheckoutComplete={onCheckoutComplete}
      />
    )
  }

  if (pathname === '/checkout/return') {
    return (
      <CheckoutPage
        cart={cart}
        onNavigate={onNavigate}
        onCheckoutComplete={onCheckoutComplete}
        mode="return"
      />
    )
  }

  if (productSlug) {
    if (!matchedProduct) {
      return <ProductMissingPage onNavigate={onNavigate} />
    }

    return (
      <ProductPage
        product={matchedProduct}
        shirtInventory={shirtInventory}
        cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)}
        onAddToCart={onAddToCart}
        onNavigate={onNavigate}
      />
    )
  }

  if (merchPageContent[pathname]) {
    return (
      <CategoryPage
        content={{
          ...merchPageContent[pathname],
          cards: categoryCards(pathname, customProducts),
        }}
        onNavigate={onNavigate}
      />
    )
  }

  if (pathname === '/about') {
    return <AboutPage onNavigate={onNavigate} />
  }

  if (pathname === '/contact') {
    return <ContactPage onNavigate={onNavigate} />
  }

  if (pathname === '/faq') {
    return <FaqPage onNavigate={onNavigate} />
  }

  if (pathname === '/tos') {
    return <TermsPage onNavigate={onNavigate} />
  }

  if (pathname === '/privacy-policy') {
    return <PrivacyPolicyPage onNavigate={onNavigate} />
  }

  if (pathname === '/messaging-service-privacy-policy') {
    return <MessagingPrivacyPolicyPage onNavigate={onNavigate} />
  }

  if (pathname === '/refunds') {
    return <RefundPolicyPage />
  }

  if (policyPages[pathname]) {
    return <PolicyPage content={policyPages[pathname]} onNavigate={onNavigate} />
  }

  if (pathname === '/dev' || pathname === '/dev/orders' || pathname === '/dev/customers' || pathname === '/dev/backups') {
    return (
      <DevPage
        categories={merchCategoryLinks}
        products={customProducts}
        onSaveProduct={onSaveProduct}
        onUpdateProduct={onUpdateProduct}
        onDeleteProduct={onDeleteProduct}
        onNavigate={onNavigate}
        pathname={pathname}
        storageError={storageError}
      />
    )
  }

  return <MapHome featuredItems={featuredItems} utahItems={utahItems} onNavigate={onNavigate} />
}

function pageTitle(pathname, productCatalog) {
  const currentLink = categoryLinks.find((link) => link.href === pathname)
  const productSlug = productSlugFromPath(pathname)
  const matchedProduct = productSlug
    ? productCatalog.find((product) => product.slug === productSlug)
    : null

  if (pathname === '/faq') {
    return 'FAQ | matsumoto*'
  }

  if (pathname === '/tos') {
    return 'Terms of Service | matsumoto*'
  }

  if (pathname === '/privacy-policy') {
    return 'Privacy Policy | matsumoto*'
  }

  if (pathname === '/refunds') {
    return 'Refund Policy | matsumoto*'
  }

  if (pathname === '/messaging-service-privacy-policy') {
    return 'Messaging Service Privacy Policy | matsumoto*'
  }

  if (pathname === '/dev') {
    return 'Dev Upload Products | matsumoto*'
  }

  if (pathname === '/dev/orders') {
    return 'Dev Orders | matsumoto*'
  }

  if (pathname === '/dev/customers') {
    return 'Dev Customers | matsumoto*'
  }

  if (pathname === '/dev/backups') {
    return 'Dev Store Backups | matsumoto*'
  }

  if (pathname === '/cart') {
    return 'Cart | matsumoto*'
  }

  if (pathname === '/checkout') {
    return 'Checkout | matsumoto*'
  }

  if (pathname === '/checkout/return') {
    return 'Checkout Return | matsumoto*'
  }

  if (matchedProduct) {
    return `${matchedProduct.name} | matsumoto*`
  }

  if (!currentLink) {
    return 'matsumoto*'
  }

  return `${currentLink.label} | matsumoto*`
}

function App() {
  const [pathname, setPathname] = useState(() =>
    normalizePath(window.location.pathname),
  )
  const [customProducts, setCustomProducts] = useState([])
  const [shirtInventory, setShirtInventory] = useState(null)
  const [cart, setCart] = useState(() => readCartStorage())
  const [storageError, setStorageError] = useState('')

  useEffect(() => {
    const onPopState = () => {
      setPathname(normalizePath(window.location.pathname))
    }

    window.addEventListener('popstate', onPopState)

    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    let isActive = true

    getStoredProducts()
      .then((storedProducts) => {
        if (!isActive) {
          return
        }

        setCustomProducts(storedProducts)
      })
      .catch(() => {
        if (!isActive) {
          return
        }

        setStorageError('Saved products could not be loaded from this browser.')
      })

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    let isActive = true

    getPublicShirtInventory()
      .then((inventory) => {
        if (!isActive) {
          return
        }

        setShirtInventory(inventory)
      })
      .catch(() => {
        if (!isActive) {
          return
        }

        setShirtInventory(null)
      })

    return () => {
      isActive = false
    }
  }, [])

  const productCatalog = buildStoreCatalog(customProducts)

  useEffect(() => {
    document.title = pageTitle(pathname, productCatalog)
    window.scrollTo(0, 0)
  }, [pathname, customProducts])

  useEffect(() => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart))
  }, [cart])

  const handleNavigate = (event, nextPath) => {
    if (!shouldHandleClientNav(event)) {
      return
    }

    event.preventDefault()

    const normalizedNextPath = normalizePath(nextPath)

    if (normalizedNextPath === pathname) {
      window.scrollTo(0, 0)
      return
    }

    window.history.pushState({}, '', normalizedNextPath)
    setPathname(normalizedNextPath)
  }

  const handleSaveProduct = async (product) => {
    const savedProduct = await saveStoredProduct(product)
    setCustomProducts((currentProducts) => [savedProduct, ...currentProducts])
    setStorageError('')
    return savedProduct
  }

  const handleDeleteProduct = async (productId) => {
    await deleteStoredProduct(productId)
    setCustomProducts((currentProducts) =>
      currentProducts.filter((product) => product.id !== productId),
    )
  }

  const handleUpdateProduct = async (productId, product) => {
    const updatedProduct = await updateStoredProduct(productId, product)
    setCustomProducts((currentProducts) =>
      currentProducts.map((currentProduct) =>
        currentProduct.id === productId ? updatedProduct : currentProduct,
      ),
    )
    setStorageError('')
    return updatedProduct
  }

  const handleAddToCart = ({ product, color, size, quantity }) => {
    setCart((currentCart) => {
      const key = cartItemKey({ productId: product.id, color, size })
      const availableQuantity = getAvailableQuantity(product, shirtInventory, color, size)

      if (availableQuantity !== null && availableQuantity <= 0) {
        return currentCart
      }

      const existingItem = currentCart.find((item) => item.key === key)
      const nextQuantity = (existingItem?.quantity || 0) + quantity
      const cappedQuantity =
        availableQuantity === null ? nextQuantity : Math.min(nextQuantity, availableQuantity)

      if (existingItem) {
        return currentCart.map((item) =>
          item.key === key ? { ...item, quantity: Math.max(1, cappedQuantity) } : item,
        )
      }

      return [
        {
          key,
          productId: product.id,
          slug: product.slug,
          category: product.category,
          name: product.name,
          image: product.images?.[0] || '/tee-mockup.png',
          price: product.price,
          hasDeal: product.hasDeal,
          salePrice: product.salePrice,
          color,
          size,
          quantity: Math.max(1, cappedQuantity),
          productType: product.productType,
          inventoryScope: product.inventoryScope,
        },
        ...currentCart,
      ]
    })
  }

  const handleRemoveFromCart = (itemKey) => {
    setCart((currentCart) => currentCart.filter((item) => item.key !== itemKey))
  }

  const handleUpdateCartQuantity = (itemKey, quantity) => {
    setCart((currentCart) =>
      currentCart.map((item) => {
        if (item.key !== itemKey) {
          return item
        }

        const availableQuantity = getAvailableQuantity(item, shirtInventory, item.color, item.size)

        if (availableQuantity !== null && availableQuantity <= 0) {
          return item
        }

        const cappedQuantity =
          availableQuantity === null ? quantity : Math.min(quantity, availableQuantity)

        return {
          ...item,
          quantity: Math.max(1, cappedQuantity),
        }
      }),
    )
  }

  const handleCheckoutComplete = () => {
    setCart([])
  }

  const featuredItems = buildCollectionItems(
    customProducts,
    'addToFeaturedCollection',
    featuredFallbackItems,
  )
  const utahItems = buildCollectionItems(
    customProducts,
    'addToUtahCollection',
    featuredFallbackItems,
  )
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <main className="page-shell">
      <header className="topbar">
        <a
          className="brand-mark"
          href="/"
          aria-label="Matsumoto home"
          onClick={(event) => handleNavigate(event, '/')}
        >
          <img src="/store-logo-white.png" alt="Matsumoto" />
        </a>
        <nav className="topnav" aria-label="Primary">
          {categoryLinks.map((link) => (
            <a
              key={link.id}
              href={link.href}
              onClick={(event) => handleNavigate(event, link.href)}
            >
              {link.label}
            </a>
          ))}
          <a
            className="topnav-cart"
            href="/cart"
            onClick={(event) => handleNavigate(event, '/cart')}
            aria-label={`View cart with ${cartCount} item${cartCount === 1 ? '' : 's'}`}
          >
            <img src={cartLogo} alt="" aria-hidden="true" />
            <span>{cartCount}</span>
          </a>
        </nav>
      </header>

      {renderPage(
        pathname,
        handleNavigate,
        customProducts,
        featuredItems,
        utahItems,
        productCatalog,
        shirtInventory,
        cart,
        handleAddToCart,
        handleRemoveFromCart,
        handleUpdateCartQuantity,
        handleCheckoutComplete,
        handleSaveProduct,
        handleUpdateProduct,
        handleDeleteProduct,
        storageError,
      )}
      <SiteFooter onNavigate={handleNavigate} />
    </main>
  )
}

export default App
