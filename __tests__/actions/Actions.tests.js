require('babelify/polyfill');

jest.dontMock('util');
jest.dontMock('capitalize');
jest.dontMock('immutable');
jest.dontMock('../../app/actions/Actions');

var url = 'http://www.test.com/';

var FluxxorTestUtils, Immutable, fakeFlux, myActionsSpy, redditAPI, myStore, state;
beforeEach(function() {
  Immutable = require('immutable');

  var Snoocore = require('snoocore');
  redditAPI = new Snoocore();
  FluxxorTestUtils = require('fluxxor-test-utils').extendJasmineMatchers(this);

  // Create an empty global `localStorage` variable.
  localStorage = {};
  var RedditStore = require('../../app/stores/RedditStore');
  var Actions = require('../../app/actions/Actions');
  fakeFlux = FluxxorTestUtils.fakeFlux({ RedditStore: new RedditStore() }, Actions);
  myActionsSpy = fakeFlux.makeActionsDispatchSpy();

  state = {
    post: Immutable.fromJS({ id: '123' }),
    sortBy: 'best'
  };
  myStore = fakeFlux.store('RedditStore');
  myStore.getState = jest.genMockFunction().mockImplementation(function() {
    return state;
  });
});

describe('updateUrl', function() {
  it('gets the best post (most upvotes) when the URL is changed', function() {
    fakeFlux.actions.reloadComments = jest.genMockFunction();
    fakeFlux.actions.updateUrl(url);
    var calls = myActionsSpy.getCalls();
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([ 'UPDATING_URL', url ]);
    expect(calls[1][0]).toBe('UPDATED_URL');
    expect(calls[1][1].subreddit).toBe('programming');
    expect(fakeFlux.actions.reloadComments).toBeCalled();
  });
});

describe('login', function() {
  it('opens an auth window on login and posts a message to the main window with auth credentials', function() {
    fakeFlux.actions.saveSession = jest.genMockFunction();
    var savedCallback;
    window.addEventListener = jest.genMockFunction().mockImplementation(function(type, callback) {
      savedCallback = callback;
    });
    window.open = jest.genMockFunction().mockImplementation(function() {
      savedCallback({ data: 'the_token' });
    });
    redditAPI.getImplicitAuthUrl = jest.genMockFunction().mockImplementation(function() {
      return 'http://www.reddit.com/some_auth_url';
    });
    fakeFlux.actions.reloadComments = jest.genMockFunction();
    fakeFlux.actions.login();
    expect(redditAPI.auth).toBeCalledWith('the_token');
    expect(window.open).toBeCalledWith('http://www.reddit.com/some_auth_url', 'RedditAuth', 'height=800,width=1024');
    var calls = myActionsSpy.getCalls();
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([ 'LOGGING_IN' ]);
    expect(calls[1]).toEqual([ 'LOGGED_IN', 'username' ]);
    expect(fakeFlux.actions.reloadComments).toBeCalledWith({ post: state.post, sortBy: state.sortBy });
  });
});

describe('logout', function() {
  it('revokes the token, clears the session store and informs the store', function() {
    fakeFlux.actions.reloadComments = jest.genMockFunction();
    localStorage.superComments = { token: 'foo' };
    fakeFlux.actions.logout();
    // expect(redditAPI.deauth).toBeCalled(); // uncomment when `deauth` is supported properly
    expect(localStorage.superComments).toBeUndefined();
    expect(myActionsSpy.getLastCall()).toEqual(['LOGOUT']);
    expect(fakeFlux.actions.reloadComments).toBeCalledWith({ post: state.post, sortBy: state.sortBy });
  });
});

describe('submitComment', function() {
  it('submits the comment and informs the store', function() {
    var payload  = {
      parent: Immutable.fromJS({ replies: [] }),
      body: 'the_text',
      thing_id: '123'
    };
    fakeFlux.actions.submitComment(payload);
    var calls = myActionsSpy.getCalls();
    var tempId = calls[0][1].id;
    payload.id = tempId;
    expect(calls.length).toBe(4);
    expect(calls[0]).toEqual([ 'ITEM_CHANGED', { comment: payload.parent, newState: { postError: null }} ]);
    expect(calls[1]).toEqual([ 'ITEM_CHANGED', {
      comment: payload.parent,
      newState: { replyFormVisible: false, formExpanded: false, replyBody: '' }
    }]);
    expect(calls[2]).toEqual([ 'SUBMITTING_COMMENT', payload ]);
    expect(calls[3]).toEqual([
      'SUBMITTED_COMMENT',
      { id: tempId, comment: redditAPI('/api/comment').payload.json.data.things[0].data }
    ]);
    expect(redditAPI('/api/comment').post).toBeCalledWith({ text: payload.body, thing_id: payload.parent.name });
  });
  it('raises an error if the comment body is empty', function() {
    var payload  = {
      parent: { replies: [] },
      thing_id: '123'
    };
    fakeFlux.actions.submitComment(payload);
    var calls = myActionsSpy.getCalls();
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([ 'ITEM_CHANGED', { comment: payload.parent, newState: { postError: null }} ]);
    expect(calls[1]).toEqual([ 'ITEM_CHANGED', { comment: payload.parent, newState: { postError: 'COMMENT_EMPTY' }} ]);
  });
  it('tries again to load the post if it is not there and raises an error if that fails', function() {
    state = {
      url: 'fail', // Tell the API mock to fail to find anything
      sortBy: 'best'
    };
    myStore = fakeFlux.store('RedditStore');
    myStore.getState = jest.genMockFunction().mockImplementation(function() {
      return state;
    });
    var payload  = {
      parent: { replies: [] },
      body: 'the_text',
      thing_id: '123'
    };
    fakeFlux.actions.submitComment(payload);
    var calls = myActionsSpy.getCalls();
    expect(calls.length).toBe(4);
    expect(calls[0]).toEqual([ 'ITEM_CHANGED', { comment: payload.parent, newState: { postError: null }} ]);
    expect(calls[1]).toEqual([ 'UPDATED_URL', null ]);
    expect(calls[2]).toEqual([ 'ITEM_CHANGED', { comment: payload.parent, newState: { postError: null }} ]);
    expect(calls[3]).toEqual([ 'ITEM_CHANGED', { comment: payload.parent, newState: { postError: 'PAGE_NOT_SUBMITTED' }} ]);    
  });
});

describe('vote', function() {
  it('submits the vote and informs the store', function() {
    var payload = {
      thing: Immutable.fromJS({ name: 'thing_name', likes: null, score: 10 }),
      dir: -1
    };
    fakeFlux.actions.vote(payload);
    var calls = myActionsSpy.getCalls();
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([ 'VOTING', payload ]);
    expect(calls[1]).toEqual([ 'VOTED', payload.thing ]);
    expect(redditAPI('/api/vote').post).toBeCalledWith({ id: 'thing_name', dir: -1 });
  });
});

describe('editComment', function() {
  it('submits the new body and informs the store', function() {
    var comment = Immutable.fromJS({ name: 'the_name', body: 'old_body' });
    var payload = { comment: comment, body: 'new_body' };
    fakeFlux.actions.editComment(payload);
    var calls = myActionsSpy.getCalls();
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([ 'EDITING_COMMENT', payload ]);
    expect(calls[1]).toEqual([ 'EDITED_COMMENT', comment ]);
    expect(redditAPI('/api/editusertext').post).toBeCalledWith({ thing_id: 'the_name', text: 'new_body' });
  });
});

describe('deleteComment', function() {
  it('deletes the comment and informs the store', function() {
    var comment = Immutable.fromJS({ name: 'the_name', author: 'the_author', body: 'old_body' });
    fakeFlux.actions.deleteComment(comment);
    var calls = myActionsSpy.getCalls();
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([ 'DELETING_COMMENT', comment ]);
    expect(calls[1]).toEqual([ 'DELETED_COMMENT', comment ]);
    expect(redditAPI('/api/del').post).toBeCalledWith({ id: 'the_name' });
  });
});

describe('reloadComments', function() {
  it('just informs the store if there is no post', function() {
    myStore.getState().post = null;
    myStore.getState().comments = null;
    fakeFlux.actions.reloadComments({ post: null, sortBy: 'new' });
    var calls = myActionsSpy.getCalls();
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([ 'RELOADING_COMMENTS' ]);
    expect(calls[1]).toEqual([ 'RELOADED_COMMENTS', null ]);
  });
  it('loads the comments if there is a post', function() {
    fakeFlux.actions.reloadComments({ post: state.post, sortBy: 'new' });
    var calls = myActionsSpy.getCalls();
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([ 'RELOADING_COMMENTS' ]);
    // Just compare the type since comparing the payload is simply too slow
    expect(calls[1][0]).toBe('RELOADED_COMMENTS');
    expect(redditAPI('comments/123.json').get).toBeCalledWith({ sort: 'new' });
  });
});

describe('sorting', function() {
  it('informs the store and reloads comments with sorting by best', function() {
    fakeFlux.actions.reloadComments = jest.genMockFunction();
    fakeFlux.actions.sortByBest();
    expect(myActionsSpy.getLastCall()).toEqual([ 'SORT_BY_BEST' ]);
    expect(fakeFlux.actions.reloadComments).toBeCalledWith({ post: state.post, sortBy: 'best' });
  });
  it('informs the store and reloads comments with sorting by newest', function() {
    myStore.getState().sortBy = 'new';
    fakeFlux.actions.reloadComments = jest.genMockFunction();
    fakeFlux.actions.sortByNewest();
    expect(myActionsSpy.getLastCall()).toEqual([ 'SORT_BY_NEWEST' ]);
    expect(fakeFlux.actions.reloadComments).toBeCalledWith({ post: state.post, sortBy: 'new' });
  });
  it('informs the store and reloads comments with sorting by oldest', function() {
    myStore.getState().sortBy = 'old';
    fakeFlux.actions.reloadComments = jest.genMockFunction();
    fakeFlux.actions.sortByOldest();
    expect(myActionsSpy.getLastCall()).toEqual([ 'SORT_BY_OLDEST' ]);
    expect(fakeFlux.actions.reloadComments).toBeCalledWith({ post: state.post, sortBy: 'old' });
  });
});