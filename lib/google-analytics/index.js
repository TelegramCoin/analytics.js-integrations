
/**
 * Module dependencies.
 */

var integration = require('analytics.js-integration');
var push = require('global-queue')('_gaq');
var length = require('object').length;
var canonical = require('canonical');
var useHttps = require('use-https');
var Track = require('facade').Track;
var callback = require('callback');
var load = require('load-script');
var keys = require('object').keys;
var dot = require('obj-case');
var each = require('each');
var type = require('type');
var url = require('url');
var is = require('is');
var group;
var user;

/**
 * Expose plugin.
 */

module.exports = exports = function(analytics){
  analytics.addIntegration(GA);
  group = analytics.group();
  user = analytics.user();
};

/**
 * Expose `GA` integration.
 *
 * http://support.google.com/analytics/bin/answer.py?hl=en&answer=2558867
 * https://developers.google.com/analytics/devguides/collection/gajs/methods/gaJSApiBasicConfiguration#_gat.GA_Tracker_._setSiteSpeedSampleRate
 */

var GA = exports.Integration = integration('Google Analytics')
  .readyOnLoad()
  .global('ga')
  .global('gaplugins')
  .global('_gaq')
  .global('GoogleAnalyticsObject')
  .option('anonymizeIp', false)
  .option('classic', false)
  .option('domain', 'auto')
  .option('doubleClick', false)
  .option('enhancedLinkAttribution', false)
  .option('nonInteraction', false)
  .option('ignoredReferrers', null)
  .option('includeSearch', false)
  .option('siteSpeedSampleRate', 1)
  .option('trackingId', '')
  .option('trackNamedPages', true)
  .option('trackCategorizedPages', true)
  .option('sendUserId', false)
  .option('metrics', {})
  .option('dimensions', {})
  .tag('library', '<script src="//www.google-analytics.com/analytics.js">')
  .tag('double click', '<script src="//stats.g.doubleclick.net/dc.js">')
  .tag('http', '<script src="http://www.google-analytics.com/ga.js">')
  .tag('https', '<script src="https://ssl.google-analytics.com/ga.js">');

/**
 * When in "classic" mode, on `construct` swap all of the method to point to
 * their classic counterparts.
 */

GA.on('construct', function(integration){
  if (!integration.options.classic) return;
  integration.initialize = integration.initializeClassic;
  integration.loaded = integration.loadedClassic;
  integration.page = integration.pageClassic;
  integration.track = integration.trackClassic;
  integration.completedOrder = integration.completedOrderClassic;
});

/**
 * Initialize.
 *
 * https://developers.google.com/analytics/devguides/collection/analyticsjs/advanced
 */

GA.prototype.initialize = function(){
  var opts = this.options;

  // setup the tracker globals
  window.GoogleAnalyticsObject = 'ga';
  window.ga = window.ga || function(){
    window.ga.q = window.ga.q || [];
    window.ga.q.push(arguments);
  };
  window.ga.l = new Date().getTime();

  if(window.location.hostname == 'localhost') opts.domain = 'none';

  window.ga('create', opts.trackingId, {
    cookieDomain: opts.domain || GA.prototype.defaults.domain, // to protect against empty string
    siteSpeedSampleRate: opts.siteSpeedSampleRate,
    allowLinker: true
  });

  // display advertising
  if (opts.doubleClick) {
    window.ga('require', 'displayfeatures');
  }

  // send global id
  if (opts.sendUserId && user.id()) {
    window.ga('set', 'userId', user.id());
  }

  // anonymize after initializing, otherwise a warning is shown
  // in google analytics debugger
  if (opts.anonymizeIp) window.ga('set', 'anonymizeIp', true);

  // custom dimensions & metrics
  var custom = metrics(user.traits(), opts);
  if (length(custom)) window.ga('set', custom);

  this.load('library', this.ready);
};

/**
 * Loaded?
 *
 * @return {Boolean}
 */

GA.prototype.loaded = function(){
  return !! window.gaplugins;
};

/**
 * Page.
 *
 * https://developers.google.com/analytics/devguides/collection/analyticsjs/pages
 *
 * @param {Page} page
 */

GA.prototype.page = function(page){
  var category = page.category();
  var props = page.properties();
  var name = page.fullName();
  var pageview = {};
  var track;

  this._category = category; // store for later

  // send
  window.ga('send', 'pageview', {
    page: path(props, this.options),
    title: name || props.title,
    location: props.url
  });

  // categorized pages
  if (category && this.options.trackCategorizedPages) {
    track = page.track(category);
    this.track(track, { nonInteraction: 1 });
  }

  // named pages
  if (name && this.options.trackNamedPages) {
    track = page.track(name);
    this.track(track, { nonInteraction: 1 });
  }
};

/**
 * Track.
 *
 * https://developers.google.com/analytics/devguides/collection/analyticsjs/events
 * https://developers.google.com/analytics/devguides/collection/analyticsjs/field-reference
 *
 * @param {Track} event
 */

GA.prototype.track = function(track, options){
  var opts = options || track.options(this.name);
  var props = track.properties();
  window.ga('send', 'event', {
    eventAction: track.event(),
    eventCategory: props.category || this._category || 'All',
    eventLabel: props.label,
    eventValue: formatValue(props.value || track.revenue()),
    nonInteraction: !!(props.nonInteraction || opts.nonInteraction)
  });
};

/**
 * Completed order.
 *
 * https://developers.google.com/analytics/devguides/collection/analyticsjs/ecommerce
 * https://developers.google.com/analytics/devguides/collection/analyticsjs/ecommerce#multicurrency
 *
 * @param {Track} track
 * @api private
 */

GA.prototype.completedOrder = function(track){
  var total = track.total() || track.revenue() || 0;
  var orderId = track.orderId();
  var products = track.products();
  var props = track.properties();

  // orderId is required.
  if (!orderId) return;

  // require ecommerce
  if (!this.ecommerce) {
    window.ga('require', 'ecommerce');
    this.ecommerce = true;
  }

  // add transaction
  window.ga('ecommerce:addTransaction', {
    affiliation: props.affiliation,
    shipping: track.shipping(),
    revenue: total,
    tax: track.tax(),
    id: orderId,
    currency: track.currency()
  });

  // add products
  each(products, function(product){
    var track = new Track({ properties: product });
    window.ga('ecommerce:addItem', {
      category: track.category(),
      quantity: track.quantity(),
      price: track.price(),
      name: track.name(),
      sku: track.sku(),
      id: orderId,
      currency: track.currency()
    });
  });

  // send
  window.ga('ecommerce:send');
};

/**
 * Initialize (classic).
 *
 * https://developers.google.com/analytics/devguides/collection/gajs/methods/gaJSApiBasicConfiguration
 */

GA.prototype.initializeClassic = function(){
  var opts = this.options;
  var anonymize = opts.anonymizeIp;
  var db = opts.doubleClick;
  var domain = opts.domain;
  var enhanced = opts.enhancedLinkAttribution;
  var ignore = opts.ignoredReferrers;
  var sample = opts.siteSpeedSampleRate;

  window._gaq = window._gaq || [];
  push('_setAccount', opts.trackingId);
  push('_setAllowLinker', true);

  if (anonymize) push('_gat._anonymizeIp');
  if (domain) push('_setDomainName', domain);
  if (sample) push('_setSiteSpeedSampleRate', sample);

  if (enhanced) {
    var protocol = 'https:' === document.location.protocol ? 'https:' : 'http:';
    var pluginUrl = protocol + '//www.google-analytics.com/plugins/ga/inpage_linkid.js';
    push('_require', 'inpage_linkid', pluginUrl);
  }

  if (ignore) {
    if (!is.array(ignore)) ignore = [ignore];
    each(ignore, function (domain) {
      push('_addIgnoredRef', domain);
    });
  }

  if (this.options.doubleClick) {
    this.load('double click', this.ready);
  } else {
    var name = useHttps() ? 'https' : 'http';
    this.load(name, this.ready);
  }
};

/**
 * Loaded? (classic)
 *
 * @return {Boolean}
 */

GA.prototype.loadedClassic = function(){
  return !! (window._gaq && window._gaq.push !== Array.prototype.push);
};

/**
 * Page (classic).
 *
 * https://developers.google.com/analytics/devguides/collection/gajs/methods/gaJSApiBasicConfiguration
 *
 * @param {Page} page
 */

GA.prototype.pageClassic = function(page){
  var opts = page.options(this.name);
  var category = page.category();
  var props = page.properties();
  var name = page.fullName();
  var track;

  push('_trackPageview', path(props, this.options));

  // categorized pages
  if (category && this.options.trackCategorizedPages) {
    track = page.track(category);
    this.track(track, { nonInteraction: 1 });
  }

  // named pages
  if (name && this.options.trackNamedPages) {
    track = page.track(name);
    this.track(track, { nonInteraction: 1 });
  }
};

/**
 * Track (classic).
 *
 * https://developers.google.com/analytics/devguides/collection/gajs/methods/gaJSApiEventTracking
 *
 * @param {Track} track
 */

GA.prototype.trackClassic = function(track, options){
  var opts = options || track.options(this.name);
  var props = track.properties();
  var revenue = track.revenue();
  var event = track.event();
  var category = this._category || props.category || 'All';
  var label = props.label;
  var value = formatValue(revenue || props.value);
  var nonInteraction = !!(props.nonInteraction || opts.nonInteraction);
  push('_trackEvent', category, event, label, value, nonInteraction);
};

/**
 * Completed order.
 *
 * https://developers.google.com/analytics/devguides/collection/gajs/gaTrackingEcommerce
 * https://developers.google.com/analytics/devguides/collection/gajs/gaTrackingEcommerce#localcurrencies
 *
 * @param {Track} track
 * @api private
 */

GA.prototype.completedOrderClassic = function(track){
  var total = track.total() || track.revenue() || 0;
  var orderId = track.orderId();
  var products = track.products() || [];
  var props = track.properties();
  var currency = track.currency();

  // required
  if (!orderId) return;

  // add transaction
  push('_addTrans'
    , orderId
    , props.affiliation
    , total
    , track.tax()
    , track.shipping()
    , track.city()
    , track.state()
    , track.country());

  // add items
  each(products, function(product){
    var track = new Track({ properties: product });
    push('_addItem'
      , orderId
      , track.sku()
      , track.name()
      , track.category()
      , track.price()
      , track.quantity());
  });

  // send
  push('_set', 'currencyCode', currency);
  push('_trackTrans');
};

/**
 * Return the path based on `properties` and `options`.
 *
 * @param {Object} properties
 * @param {Object} options
 */

function path(properties, options) {
  if (!properties) return;
  var str = properties.path;
  if (options.includeSearch && properties.search) str += properties.search;
  return str;
}

/**
 * Format the value property to Google's liking.
 *
 * @param {Number} value
 * @return {Number}
 */

function formatValue(value) {
  if (!value || value < 0) return 0;
  return Math.round(value);
}

/**
 * Map google's custom dimensions & metrics with `obj`.
 *
 * Example:
 *
 *      metrics({ revenue: 1.9 }, { { metrics : { revenue: 'metric8' } });
 *      // => { metric8: 1.9 }
 *
 *      metrics({ revenue: 1.9 }, {});
 *      // => {}
 *
 * @param {Object} obj
 * @param {Object} data
 * @return {Object|null}
 * @api private
 */

function metrics(obj, data){
  var dimensions = data.dimensions;
  var metrics = data.metrics;
  var names = keys(metrics).concat(keys(dimensions));
  var ret = {};

  for (var i = 0; i < names.length; ++i) {
    var name = names[i];
    var key = metrics[name] || dimensions[name];
    var value = dot(obj, name) || obj[name];
    if (null == value) continue;
    ret[key] = value;
  }

  return ret;
}
