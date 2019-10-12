import InfoBarWidget from './InfoBarWidget';
import RevisionPopupWidget from './RevisionPopupWidget';
import wwtController from './Controller';

/**
 * Application class, responsible for managing the WWT ui
 * and the actions on the DOM returned by the API
 *
 * @class
 */
class App {
	/**
	 * Only instantiate once, so the initialization doesn't run again
	 * even if this is called on multiple clicks/calls
	 *
	 * @constructor
	 * @param {App} A class instance
	 */
	constructor() {
		// Instantiate only once
		if ( !App.instance ) {
			App.instance = this;
		}

		this.model = wwtController.getModel();

		this.revisionPopup = new RevisionPopupWidget();
		this.widget = new InfoBarWidget();

		// Attach widget
		if ( $( 'body' ).hasClass( 'skin-timeless' ) ) {
			$( '#mw-content-wrapper' ).prepend( this.widget.$element );
		} else {
			$( '#content' ).prepend( this.widget.$element );
		}

		// Attach popup
		$( 'body' ).append( this.revisionPopup.$element );

		// Attach events
		this.$content = null;
		this.model.on( 'state', state => {
			if ( state === 'ready' ) {
				this.scrollDown();
			}
		} );

		return App.instance;
	}

	/**
	 * Reset the content and prepare it for interactive actions.
	 * This is happening either at first request from WikiWho or at
	 * any subsequent times we need to refresh this content, like
	 * when an edit action happened without refresh, with VisualEditor.
	 * Storing the interactive content means we can attach events
	 * to it once and not repeatedly have to reset those.
	 *
	 * @param {string} html HTML of the new content
	 */
	resetContentFromHTML( html ) {
		// We're getting the div.mw-parser-output but we want
		// only what's actually inside it
		this.$content = $( $.parseHTML( html ) ).contents();
		this.attachContentListeners( this.$content );
	}

	/**
	 * Get the interactive content of this article, based on the content
	 * received from the WikiWho API that was then augmented with event
	 * handlers.
	 *
	 * @return {jQuery} jQuery element representing the interactive content
	 */
	getInteractiveContent() {
		return this.$content;
	}

	/**
	 * Scroll down to the content on a diff page
	 * if it is below or in the lower third of the viewport.
	 */
	scrollDown() {
		const viewBottom = window.scrollY + ( window.innerHeight * ( 2 / 3 ) ),
			$diffHead = $( 'h2.diff-currentversion-title' );
		if ( $diffHead.length === 1 ) {
			const contentTop = $diffHead.offset().top,
				infobarHeight = this.widget.$element.outerHeight( true );
			if ( contentTop > viewBottom ) {
				// Scroll to below the WWT info bar. Redundant selector is for Safari.
				$( 'html, body' ).animate( { scrollTop: contentTop - infobarHeight } );
			}
		}
	}

	/**
	 * Activate all the spans belonging to the given user.
	 *
	 * @param {jQuery} $content The content to apply events on
	 * @param {number} editorId
	 */
	activateSpans( $content, editorId ) {
		$content.find( '.token-editor-' + editorId ).addClass( 'active' );
	}

	/**
	 * Deactivate all spans.
	 *
	 * @param {jQuery} $content The content to apply events on
	 */
	deactivateSpans( $content ) {
		$content.find( '.editor-token' ).removeClass( 'active' );
	}

	/**
	 * Extract token and editor IDs from a WikiWho span element with `id='token-X'` and
	 * `class='token-editor-Y'` attributes.
	 *
	 * @param {HTMLElement} element
	 * @return {Object} An object with two parameters: tokenId and editorId (string).
	 */
	getIdsFromElement( element ) {
		const out = { tokenId: false, editorId: false },
			tokenMatches = element.id.match( /token-(\d+)/ ),
			editorMatches = element.className.match( /token-editor-([^\s]+)/ );
		if ( tokenMatches && tokenMatches[ 1 ] ) {
			out.tokenId = parseInt( tokenMatches[ 1 ] );
		}
		if ( editorMatches && editorMatches[ 1 ] ) {
			out.editorId = editorMatches[ 1 ];
		}
		return out;
	}

	/**
	 * Add listeners to:
	 *   - highlight attribution;
	 *   - show the RevisionPopupWidget; and
	 *   - scroll to the right place for fragment links.
	 *
	 * @param {jQuery} $content The content to apply events on
	 */
	attachContentListeners( $content ) {
		$content.find( '.editor-token' )
			.on( 'mouseenter', e => {
				if ( this.revisionPopup.isVisible() ) {
					return;
				}
				const ids = this.getIdsFromElement( e.currentTarget ),
					tokenInfo = wwtController.getApi().getTokenInfo( ids.tokenId );
				this.activateSpans( $content, ids.editorId );
				this.widget.setUsernameInfo( tokenInfo.username );
			} )
			.on( 'mouseleave', () => {
				if ( this.revisionPopup.isVisible() ) {
					return;
				}
				this.deactivateSpans( $content );
				this.widget.clearUsernameInfo();
			} )
			.on( 'click', e => {
				const ids = this.getIdsFromElement( e.currentTarget ),
					tokenInfo = wwtController.getApi().getTokenInfo( ids.tokenId );
				this.activateSpans( $content, ids.editorId );
				this.widget.setUsernameInfo( tokenInfo.username );
				this.revisionPopup.show( tokenInfo, $( e.currentTarget ) );
				this.revisionPopup.once( 'toggle', () => {
					this.deactivateSpans( $content );
					this.widget.clearUsernameInfo();
				} );

				// eslint-disable-next-line one-var
				const reqStartTime = Date.now();

				// Fetch edit summary then re-render the popup.
				wwtController.getApi().fetchEditSummary( tokenInfo.revisionId ).then( successData => {
					const delayTime = Date.now() - reqStartTime < 250 ? 250 : 0;
					Object.assign( tokenInfo, successData );

					setTimeout( () => {
						this.revisionPopup.show( tokenInfo, $( e.target ) );
					}, delayTime );
				}, () => {
					// Silently fail. The revision info provided by WikiWho is still present, which is
					// the important part, so we'll just show what we have and throw a console warning.
					mw.log.warn( `WhoWroteThat failed to fetch the summary for revision ${tokenInfo.revisionId}` );
				} );
			} );

		/*
		 * Modify fragment link scrolling behaviour to take into account the width of the infobar at
		 * the top of the screen, to prevent the targeted heading or citation from being hidden.
		 */
		$content.find( "a[href^='#']" ).on( 'click', event => {
			var targetId, linkOffset, infobarHeight;
			if ( !this.widget.isVisible() ) {
				// Use the default if WWT is not active.
				return;
			}
			targetId = decodeURIComponent( event.currentTarget.hash ).replace( /^#/, '' );
			event.preventDefault();
			// After preventing the default event from doing it, set the URL bar fragment manually.
			window.location.hash = targetId;
			// After setting that, manually scroll to the correct place.
			linkOffset = $( document.getElementById( targetId ) ).offset().top;
			infobarHeight = this.widget.$element.outerHeight( true );
			window.scrollTo( 0, linkOffset - infobarHeight );
		} );
	}
}

export default App;
// This should be able to load with 'require'
module.exports = App;
