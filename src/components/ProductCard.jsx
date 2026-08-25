// Temporarily hidden storewide — no ash-grey product photos exist yet.
// Remove 'ash-grey' from this list once ash-grey items are ready to sell.
const HIDDEN_COLOR_OPTIONS = ['ash-grey']

function ProductCard({ product, onNavigate }) {
  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value)
  const formatColorLabel = (value) => value.replace('-', ' ')
  const imageUrl = (image) => (typeof image === 'string' ? image : image?.url || '')
  const sizeSummary = Array.isArray(product.allowedSizes) ? product.allowedSizes.join(', ') : ''
  const primaryProductImage =
    product.images?.find((image) => image?.primary) || product.images?.[0] || null
  const secondaryProductImage =
    product.images?.find((image) => image?.secondary) ||
    product.images?.find((image) => imageUrl(image) !== imageUrl(primaryProductImage)) ||
    primaryProductImage
  const primaryImage = imageUrl(primaryProductImage) || '/tee-mockup.png'
  const hoverImage = imageUrl(secondaryProductImage) || primaryImage || '/tee-mockup-hover.jpg'
  const hasDeal = product.hasDeal && product.salePrice
  const sellableColors = product.colors?.filter((color) => !HIDDEN_COLOR_OPTIONS.includes(color))
  // The hover swap is only worth showing if there's an actually different
  // photo behind it -- true for multiple colors, but also for a single
  // color with a front/back design, so this checks for a distinct image
  // rather than counting colors.
  const hasDistinctHoverImage = hoverImage !== primaryImage
  const colorSummary = sellableColors?.length ? sellableColors.map(formatColorLabel).join(', ') : null
  const variantSummary = [colorSummary, sizeSummary].filter(Boolean).join(' • ') || null
  const productHref = `/products/${product.slug}`

  return (
    <article className={`product-card${hasDistinctHoverImage ? '' : ' product-card-single-color'}`}>
      <a
        className="product-art"
        href={productHref}
        onClick={(event) => onNavigate(event, productHref)}
        aria-label={`View ${product.name}`}
        style={{
          '--product-tint': product.tint,
        }}
      >
        <span className="product-badge">{product.tag}</span>
        <div className="product-image-wrap">
          <img
            className="product-image product-image-primary"
            src={primaryImage}
            alt={`${product.name} mockup`}
          />
          {hasDistinctHoverImage ? (
            <img
              className="product-image product-image-hover"
              src={hoverImage}
              alt=""
              aria-hidden="true"
            />
          ) : null}
        </div>
      </a>

      <div className="product-copy">
        <div className="product-meta">
          <h3>{product.name}</h3>
          {hasDeal ? (
            <span className="product-price-stack">
              <small>{formatCurrency(product.price)}</small>
              <strong>{formatCurrency(product.salePrice)}</strong>
            </span>
          ) : (
            <span>{formatCurrency(product.price)}</span>
          )}
        </div>
        {variantSummary ? <p className="product-variant-note">{variantSummary}</p> : null}
        <div className="product-actions">
          <a
            className="button button-primary"
            href={productHref}
            onClick={(event) => onNavigate(event, productHref)}
          >
            Choose options
          </a>
        </div>
      </div>
    </article>
  )
}

export default ProductCard
