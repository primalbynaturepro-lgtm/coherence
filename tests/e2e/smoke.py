"""smoke.py — the front door: code → who → first screen, on a phone that has never seen the app."""
import sys
from harness import phone

with phone() as app:
    app.open()
    app.wait_screen('code')
    app.shot('01-code')
    app.keys('2581')                                   # a wrong code
    app.wait_screen('code-faux')
    app.shot('02-code-faux')
    app.keys('2580')
    app.wait_screen('qui')
    app.shot('03-qui')
    app.tap('[data-do="who:mehdi"]')
    app.wait_screen('test-intro')                      # no rhythm yet: the test comes first
    app.shot('04-test-intro')
    print('rhythm card hidden:', not app.visible('[data-id="test-intro/current"]'), '· start button:', app.visible('[data-id="test-intro/start"]'))
    print('errors:', app.errors)
    print('logs:', app.logs[-5:])
    sys.exit(1 if app.errors else 0)
