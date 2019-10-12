import Api from './Api';
import Model from './Model';

/**
 * An activation singleton, responsible for activating and attaching the
 * button that activates the system when it is applicable.
 *
 * @class
 */
class Controller {
	/**
	 * Initialize if it is the first time, and cache the
	 * initialization for the next times.
	 */
	constructor() {
		if ( !Controller.instance ) {
			this.initialized = false;
			this.link = null;
			this.namespace = null;
			this.mainPage = false;
			this.translations = {};
			this.contentIdentifier = null;

			Controller.instance = this;

			this.app = null;
			this.api = null;
			this.model = new Model();

			// Events
			this.model.on( 'active', isActive => {
				this.toggleLinkActiveState( isActive );
				this.model.getContentWrapper()
					.toggleClass( 'wwt-active', isActive );

				// If we're deactivating, remove the state classes
				if ( !isActive ) {
					this.model.getContentWrapper()
						.removeClass( 'wwt-ready' );
				}
			} );

			// Events
			this.model.on( 'enabled', isEnabled => {
				this.getButton().toggle( isEnabled );
			} );

			this.model.on( 'state', state => {
				// Toggle a class for CSS to style links appropriately.
				this.model.getContentWrapper()
					.toggleClass( 'wwt-ready', state === 'ready' );
			} );
		}

		return Controller.instance;
	}

	/**
	 * Get the model attached to this controller
	 *
	 * @return {Model} Current model
	 */
	getModel() {
		return this.model;
	}

	/**
	 * Get the API class attached to this controller
	 *
	 * @return {Api} Current API
	 */
	getApi() {
		return this.api;
	}

	/**
	 * Initialize the process
	 *
	 * @param {jQuery} $content Page content
	 * @param {Object} config Configuration options
	 * @param {string} [config.lang="en"] User interface language
	 * @param {Object} [config.translations={}] Object with all translations
	 *  organized by language key with data of translation key/value pairs.
	 * @param {string} [config.namespace] Page namespace. Falls back to reading
	 *  directly from mw.config
	 * @param {string} [config.mainPage] Whether the current page is the main page
	 *  of the wiki. Falls back to reading directly from mw.config
	 */
	initialize( $content, config ) {
		if ( this.model.isInitialized() ) {
			return;
		}
		this.model.initialize( $content, config );

		if ( !this.model.isValidPage() ) {
			return;
		}
		this.translations = config.translations || {};

		// This validation is for tests, where
		// mw is not defined. We don't care to test
		// whether messages are set properly, since that
		// has its own tests in the mw.messsages bundle
		if ( window.mw ) {
			this.api = new Api( {
				url: config.wikiWhoUrl,
				mwApi: new mw.Api(),
				mwConfig: mw.config
			} );
			this.api.fetchMessages();

			// Load all messages
			mw.messages.set(
				Object.assign(
					{},
					// Manually create fallback on English
					this.translations.en,
					this.translations[ this.model.getLang() ]
				)
			);

			// Add a portlet link to 'tools'
			this.link = mw.util.addPortletLink(
				'p-tb',
				'#',
				mw.msg( 'whowrotethat-activation-link' ),
				't-whowrotethat',
				mw.msg( 'whowrotethat-activation-link-tooltip' )
			);

			// Add hooks for VisualEditor
			mw.hook( 've.activationComplete' ).add( () => {
				window.console.log( 'Who Wrote That: VisualEditor activated, disabling system.' );

				this.dismiss();
				this.model.toggleEnabled( false );
			} );
			mw.hook( 've.deactivationComplete' ).add( () => {
				window.console.log( 'Who Wrote That: VisualEditor deactivated, enabling system.' );
				this.model.toggleEnabled( true );
			} );

			this.initialized = true;
		}
	}

	/**
	 * Launch WWT application
	 *
	 * @return {jQuery.Promise} Promise that is resolved when the system
	 *  has finished launching, or is rejected if the system has failed to launch
	 */
	launch() {
		if ( !this.model.isEnabled() ) {
			window.console.log( 'Who Wrote That: Could not launch. System is disabled.' );
			return $.Deferred().reject();
		}

		return this.loadDependencies().then( () => {
			if ( !this.app ) {
				// Only load after dependencies are loaded
				// And only load once
				// We do this trick because our widgets are dependent
				// on OOUI, which is not available at construction time.
				// When we launch, we load dependencies and the first run
				// should make sure we also initialize the widget app
				const App = require( './App' );
				this.app = new App();
			}

			this.model.toggleActive( true );
			this.model.setState( 'pending' );
			return this.api.getData( window.location.href )
				.then(
					// Success handler.
					result => {
						// There could be time that passed between
						// activating the promise request and getting the
						// answer. During that time, the user may
						// have dismissed the system.
						// We should only replace the DOM and declare
						// ready if the system is actually ready to be
						// replaced.
						// On subsequent launches, this promise will run
						// again (no-op as an already-resolved promise)
						// and the operation below will be re-triggered
						// with the replacements
						if ( this.model.isActive() ) {
							if (
								this.contentIdentifier !== this.api.getContentRevisionIdentifier()
							) {

								// The content we get from the API has changed
								this.app.resetContentFromHTML( result.extended_html );
								this.contentIdentifier = this.api.getContentRevisionIdentifier();
							}

							// Cache original
							this.model.cacheOriginal();
							this.model.getContentWrapper()
								.empty()
								.append( this.app.getInteractiveContent() );
							this.model.setState( 'ready' );
						}

						return this.model.getContentWrapper();
					},
					// Error handler.
					errorCode => {
						this.model.setState( 'err', errorCode );
					}
				);
		} );
	}

	/**
	 * Close the WWT application
	 */
	dismiss() {
		if ( !this.model.isActive() ) {
			window.console.log( 'Who Wrote That: Could not dismiss. System is not active.' );
			return;
		}

		if ( this.model.getState() === 'ready' ) {
			// Detach the interactive content so we can keep the events and data on it
			this.app.getInteractiveContent().detach();

			// Append the original content
			this.model.getContentWrapper()
				.append( this.model.getOriginalContent() );
		}

		this.model.toggleActive( false );
	}

	/**
	 * Toggle the system; if already launched, dismiss it, and vise versa.
	 */
	toggle() {
		if ( this.model.isActive() ) {
			this.dismiss();
		} else {
			this.launch();
		}
	}

	/**
	 * Set the link text and tooltip.
	 * @param {boolean} [active] The state to toggle to.
	 */
	toggleLinkActiveState( active ) {
		const anchor = this.link.querySelector( 'a' );
		if ( active ) {
			anchor.textContent = mw.msg( 'whowrotethat-deactivation-link' );
			anchor.title = '';
		} else {
			anchor.textContent = mw.msg( 'whowrotethat-activation-link' );
			anchor.title = mw.msg( 'whowrotethat-activation-link-tooltip' );
		}
	}

	/**
	 * Load the required dependencies for the full script
	 *
	 * @return {jQuery.Promise} Promise that is resolved when
	 *  all dependencies are ready and loaded.
	 */
	loadDependencies() {
		if ( !window.mw ) {
			// This is for test environment only, where mw
			// is not defined.
			return $.Deferred().resolve();
		}

		return $.when(
			$.ready, // jQuery's document.ready
			mw.loader.using( [ // MediaWiki dependencies
				'oojs-ui',
				'oojs-ui.styles.icons-user',
				'oojs-ui.styles.icons-interactions',
				'mediawiki.interface.helpers.styles',
				'mediawiki.special.changeslist',
				'mediawiki.widgets.datetime',
				'moment'
			] )
		);
	}

	/**
	 * Get the jQuery object representing the activation button
	 *
	 * @return {jQuery} Activation button
	 */
	getButton() {
		return $( this.link );
	}
}

// Initialize the singleton
// eslint-disable-next-line one-var
const wwtController = new Controller();

export default wwtController;
