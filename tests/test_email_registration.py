from concurrent.futures import ThreadPoolExecutor
import pytest
from backend import server, storage
from backend.account_validation import normalize_email
from tests.test_features import clients


def registration(username='newuser', email='new@example.com', password='Abcdef12'):
    return dict(username=username, email=email, password=password)


def test_registration_normalizes_email_and_preserves_contract(clients):
    a, _ = clients
    body = registration(email='  New.Name+tag@EXAMPLE.COM  ')
    response = a.post('/api/auth/register',json=body)
    assert response.status_code == 200
    assert 'recovery_code' in response.json()
    assert 'email' not in response.json()  # Not copied into the offline account cache.
    with server.database() as db:
        row=db.execute('SELECT email,password FROM users WHERE username=?',('newuser',)).fetchone()
    assert row[0] == 'new.name+tag@example.com'
    assert row[1] != body['password']
    assert a.post('/api/auth/login',json={'username':'newuser','password':'Abcdef12'}).status_code == 200
    assert a.post('/api/auth/login',json={'username':'newuser','password':'wrong123'}).json()['detail'] == 'Incorrect username or password'


@pytest.mark.parametrize('email', ['', 'not-an-email', 'a@localhost', '.a@example.com', 'a..b@example.com', 'a@-example.com', 'a@ex_ample.com', 'a@exam ple.com', 'a'*65+'@example.com'])
def test_invalid_email_cannot_create_account(clients,email):
    a,_=clients
    assert a.post('/api/auth/register',json=registration(email=email)).status_code == 422
    with server.database() as db:
        assert db.execute("SELECT 1 FROM users WHERE username='newuser'").fetchone() is None


@pytest.mark.parametrize('password',['Short1A','lowercase123'])
def test_new_password_policy(clients,password):
    a,_=clients
    assert a.post('/api/auth/register',json=registration(password=password)).status_code == 422


def test_duplicate_username_email_and_database_constraint(clients):
    a,_=clients
    assert a.post('/api/auth/register',json=registration(username='alice')).json()['detail']=='This username is already taken.'
    response=a.post('/api/auth/register',json=registration(email=' ALICE@EXAMPLE.COM '))
    assert response.status_code==409
    assert response.json()['detail']=='An account with this email already exists.'
    with pytest.raises(storage.INTEGRITY_ERRORS):
        with server.database() as db:
            db.execute("UPDATE users SET email='alice@example.com' WHERE username='bob'")
    with pytest.raises(storage.INTEGRITY_ERRORS):
        with server.database() as db:
            db.execute("UPDATE users SET email='Mixed@Example.com' WHERE username='bob'")


def test_concurrent_email_registration_has_one_winner(clients):
    a,b=clients
    with ThreadPoolExecutor(max_workers=2) as workers:
        futures=[workers.submit(client.post,'/api/auth/register',json=registration(username=name)) for client,name in [(a,'first'),(b,'second')]]
        responses=[f.result() for f in futures]
    assert sorted(r.status_code for r in responses)==[200,409]
    with server.database() as db:
        assert db.execute('SELECT count(*) FROM users WHERE email=?',('new@example.com',)).fetchone()[0]==1


def test_confirmation_is_not_an_api_credential(clients):
    a,_=clients
    assert a.post('/api/auth/register',json={**registration(),'confirm_password':'Abcdef12'}).status_code==422


def test_deletion_releases_email(clients):
    a,_=clients
    assert a.request('DELETE','/api/auth/account',json={'password':'A-unique-password-123','confirm_username':'alice'}).status_code==200
    assert a.post('/api/auth/register',json=registration(email='alice@example.com')).status_code==200
