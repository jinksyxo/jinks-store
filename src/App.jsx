import { useEffect, useRef, useState } from 'react'
import './App.css'
import DevPage from './components/DevPage'
import ProductCard from './components/ProductCard'
import { products } from './data/products'
import {
  deleteStoredProduct,
  getStoredProducts,
  saveStoredProduct,
} from './lib/devPortalStore'

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
    details: [
      {
        kicker: 'fit notes',
        title: 'Start with one strong blank',
        copy:
          'Keep the first drop narrow. One consistent blank and one clear fit note will make the store read as intentional.',
      },
      {
        kicker: 'print direction',
        title: 'Show front and back placements',
        copy:
          'Use this block later for print placements, wash info, or a short note about how the shirts are made.',
      },
      {
        kicker: 'launch prep',
        title: 'Swap in real product shots',
        copy:
          'Replace the mockups with front, back, and detail photos once the garments are printed and on hand.',
      },
    ],
  },
  '/dress-shirts': {
    eyebrow: 'category two',
    title: 'dress shirts',
    intro:
      'A dedicated page for woven shirts, lighter shirting, and cleaner silhouettes that still sit inside the Matsumoto world.',
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
    eyebrow: 'category three',
    title: 'bottoms',
    intro:
      'A template page for pants, shorts, and any lower-body pieces that expand the line without breaking the current site language.',
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
      title: 'hello@matsumoto-store.com',
      copy:
        'Replace this placeholder inbox with your real store address once the site goes live.',
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

const footerLinks = [
  { label: 'contact', href: '/contact' },
  { label: 'FAQ', href: '/faq' },
  { label: 'about', href: '/about' },
]

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function formatCategoryLabel(pathname) {
  return merchCategoryLinks.find((link) => link.href === pathname)?.label ?? 'store item'
}

function buildFeaturedItems(customProducts) {
  if (!customProducts.length) {
    return featuredFallbackItems
  }

  return customProducts.slice(0, 3).map((product, index) => ({
    eyebrow: `featured item ${String(index + 1).padStart(2, '0')}`,
    title: product.name,
    price: product.hasDeal && product.salePrice
      ? `${formatCurrency(product.salePrice)} sale`
      : formatCurrency(product.price),
    copy: product.description,
    image: product.images?.[0] || '/tee-mockup.png',
    accent: formatCategoryLabel(product.category),
  }))
}

function categoryCards(pathname, customProducts) {
  const uploadedProducts = customProducts.filter((product) => product.category === pathname)

  if (uploadedProducts.length) {
    return uploadedProducts
  }

  return merchPageContent[pathname]?.cards ?? []
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

function FeaturedCarousel({ items }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const tickerTrackRef = useRef(null)
  const tickerGroupRef = useRef(null)
  const currentIndex = activeIndex >= items.length ? 0 : activeIndex

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveIndex((currentIndex) => (currentIndex + 1) % items.length)
    }, 4200)

    return () => window.clearInterval(intervalId)
  }, [items.length])

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
          <p className="eyebrow">featured items</p>
          <h2 id="featured-items-heading">collection preview</h2>
          <div className="featured-carousel-meta">
            {items.map((item, index) => (
              <button
                key={item.title}
                type="button"
                className={
                  index === currentIndex
                    ? 'featured-dot featured-dot-active'
                    : 'featured-dot'
                }
                onClick={() => setActiveIndex(index)}
                aria-label={`Show ${item.title}`}
                aria-pressed={index === currentIndex}
              />
            ))}
          </div>
        </div>

        <div className="featured-carousel-stage">
          {items.map((item, index) => (
            <article
              key={item.title}
              className={
                index === currentIndex
                  ? 'featured-slide featured-slide-active'
                  : 'featured-slide'
              }
              aria-hidden={index !== currentIndex}
            >
              <div className="featured-slide-image">
                <img src={item.image} alt={item.title} />
              </div>

              <div className="featured-slide-content">
                <p className="featured-slide-kicker">{item.eyebrow}</p>
                <div className="featured-slide-heading">
                  <h3>{item.title}</h3>
                  <span>{item.price}</span>
                </div>
                <p>{item.copy}</p>
                <span className="featured-accent">{item.accent}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function MapHome({ featuredItems, onNavigate }) {
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

      <FeaturedCarousel items={featuredItems} />
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
            <ProductCard key={`${content.title}-${product.name}`} product={product} />
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
          <h3>hello@matsumoto-store.com</h3>
          <p>
            Replace this placeholder inbox with your actual store address and
            support flow once the brand is ready to launch.
          </p>
          <a className="button button-primary" href="mailto:hello@matsumoto-store.com">
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

function SocialIcon({ kind }) {
  if (kind === 'instagram') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <circle cx="12" cy="12" r="3.4" />
        <circle cx="17.2" cy="6.8" r="1" />
      </svg>
    )
  }

  if (kind === 'tiktok') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 4v8.3a3.8 3.8 0 1 1-2.8-3.7V6.4c1.2.1 2.1.7 2.8 1.5V4h3.2c.3 1.9 1.5 3.2 3.1 3.7v2.9c-1.4-.1-2.8-.6-4-1.5v6.8a6.2 6.2 0 1 1-6.2-6.2h.5V4H14Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13.7 20v-7.1h2.4l.4-2.8h-2.8V8.3c0-.8.2-1.4 1.4-1.4h1.5V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 4v1.8H8.2v2.8h2.3V20h3.2Z" />
    </svg>
  )
}

function SiteFooter({ onNavigate }) {
  return (
    <footer className="site-footer">
      <div className="footer-column footer-links">
        {footerLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            onClick={(event) => onNavigate(event, link.href)}
          >
            {link.label}
          </a>
        ))}
      </div>

      <div className="footer-column footer-socials">
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

      <div className="footer-column footer-ascii">
        <p className="eyebrow">ASCII gif placeholder</p>
        <pre>{String.raw`+------------------+
|   /\/\  /\/\     |
|  < ASCII GIF >   |
|   \/\/  \/\/     |
+------------------+`}</pre>
      </div>
    </footer>
  )
}

function renderPage(
  pathname,
  onNavigate,
  customProducts,
  featuredItems,
  onSaveProduct,
  onDeleteProduct,
  storageError,
) {
  if (pathname === '/') {
    return <MapHome featuredItems={featuredItems} onNavigate={onNavigate} />
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

  if (pathname === '/dev') {
    return (
      <DevPage
        categories={merchCategoryLinks}
        products={customProducts}
        onSaveProduct={onSaveProduct}
        onDeleteProduct={onDeleteProduct}
        onNavigate={onNavigate}
        storageError={storageError}
      />
    )
  }

  return <MapHome featuredItems={featuredItems} onNavigate={onNavigate} />
}

function pageTitle(pathname) {
  const currentLink = categoryLinks.find((link) => link.href === pathname)

  if (pathname === '/faq') {
    return 'FAQ | matsumoto*'
  }

  if (pathname === '/dev') {
    return 'Dev | matsumoto*'
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
    document.title = pageTitle(pathname)
    window.scrollTo(0, 0)
  }, [pathname])

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

  const featuredItems = buildFeaturedItems(customProducts)

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
        </nav>
      </header>

      {renderPage(
        pathname,
        handleNavigate,
        customProducts,
        featuredItems,
        handleSaveProduct,
        handleDeleteProduct,
        storageError,
      )}
      <SiteFooter onNavigate={handleNavigate} />
    </main>
  )
}

export default App
