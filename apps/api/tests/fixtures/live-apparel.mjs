// Public catalog images are fetched transiently. Brand/gender below are catalog ground truth,
// not inferred from the wearer. This is a controlled retrieval probe, not a video-crop benchmark.
export const liveApparel = [
  { id: 'uniqlo-tee', brand: 'Uniqlo', subtype: 'T-shirt', color: 'black', sleeve: 'short', gender: null,
    page: 'https://www.uniqlo.com/jp/ja/products/E422992-000/00',
    image: 'https://image.uniqlo.com/UQ/ST3/AsianCommon/imagesgoods/422992/item/goods_09_422992.jpg?width=600' },
  { id: 'adidas-hoodie', brand: 'Adidas', subtype: 'Hoodie', color: 'blue', sleeve: 'long', gender: 'men',
    page: 'https://www.adidas.com.au/essentials-3-stripes-pullover-hoodie/GD5376.html',
    image: 'https://assets.adidas.com/images/h_840%2Cf_auto%2Cq_auto%2Cfl_lossy%2Cc_fill%2Cg_auto/9c1e54c11f8746a8b993abbf011aff86_9366/Essentials_3-Stripes_Pullover_Hoodie_Blue_GD5376_01_laydown.jpg' },
  { id: 'patagonia-jacket', brand: 'Patagonia', subtype: 'Jacket', color: 'blue', sleeve: 'long', gender: 'men',
    page: 'https://wornwear.patagonia.com/products/mens-better-sweater-jacket_25528_pgbe',
    image: 'https://cdn.shopify.com/s/files/1/0751/2601/4248/files/hg59wey21ivmpl16rsjt.jpg?v=1724161362&width=600' },
  { id: 'levis-jeans', brand: "Levi's", subtype: 'Jeans', color: 'blue', sleeve: null, gender: 'men',
    page: 'https://www.ebay.com/itm/386938305215',
    image: 'https://i.ebayimg.com/images/g/x2QAAOSwROJoBnwj/s-l1600.jpg' },
  { id: 'hm-dress', brand: 'H&M', subtype: 'Dress', color: 'black', sleeve: 'sleeveless', gender: 'women',
    page: 'https://www.ebay.com/itm/196049394395',
    image: 'https://i.ebayimg.com/images/g/dBMAAOSwqaJlORQ4/s-l1200.png' },
];
