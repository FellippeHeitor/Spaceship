$EXEICON:'ship.ico'
_ICON
_SCREENMOVE _MIDDLE
_TITLE "Spaceship"
DEFLNG A-Z

'Animation uses ASCII character 7, which normally beeps when printed to the screen.
'Let's turn this behavior off:
_CONTROLCHR OFF

'Custom types:
TYPE DevType
    ID AS INTEGER
    Name AS STRING * 256
END TYPE

TYPE ButtonMapType
    ID AS INTEGER
    Name AS STRING * 10
END TYPE

REDIM SHARED MyDevices(0) AS DevType
DIM SHARED ChosenController

'Initialize ButtonMap for the assignment routine
DIM SHARED ButtonMap(1 TO 9) AS ButtonMapType
i = 1
ButtonMap(i).Name = "START": i = i + 1
ButtonMap(i).Name = "UP": i = i + 1
ButtonMap(i).Name = "DOWN": i = i + 1
ButtonMap(i).Name = "LEFT": i = i + 1
ButtonMap(i).Name = "RIGHT": i = i + 1
ButtonMap(i).Name = "PINK": i = i + 1
ButtonMap(i).Name = "BLUE": i = i + 1
ButtonMap(i).Name = "GREEN": i = i + 1
ButtonMap(i).Name = "RED": i = i + 1

'Detection routine:
PRINT "Detecting your controller. Press any button..."
StartTime# = TIMER
DO
    x& = _DEVICEINPUT
    IF x& = 1 OR x& > 2 THEN
        'Keyboard is 1, Mouse is 2. Anything after that could be a controller.
        Found = -1
        EXIT DO
    END IF
    IF _KEYHIT = 27 THEN EXIT DO
LOOP UNTIL TIMER - StartTime# > 10

IF Found = 0 THEN
    PRINT "No controller detected."
    END
END IF

FOR i = 1 TO _DEVICES
    a$ = _DEVICE$(i)
    IF INSTR(a$, "CONTROLLER") > 0 OR INSTR(a$, "KEYBOARD") > 0 THEN
        TotalControllers = TotalControllers + 1
        REDIM _PRESERVE SHARED MyDevices(1 TO TotalControllers) AS DevType
        MyDevices(TotalControllers).ID = i
        MyDevices(TotalControllers).Name = a$
    END IF
NEXT i

IF TotalControllers > 1 THEN
    'More than one controller found, user can choose which will be used
    '(though I highly suspect this bit will never be run)
    PRINT "Controllers found:"
    FOR i = 1 TO TotalControllers
        PRINT i, MyDevices(i).Name
    NEXT i
    DO
        INPUT "Your choice (0 to quit): ", ChosenController
        IF ChosenController = 0 THEN END
    LOOP UNTIL ChosenController <= TotalControllers
ELSE
    ChosenController = 1
END IF
AssignKeys:
CLS
PRINT "Using "; RTRIM$(MyDevices(ChosenController).Name)
PRINT
PRINT "Button assignments:"
IF _FILEEXISTS("controller.dat") = 0 THEN
    i = 0

    'Wait until all buttons in the deviced are released:
    DO
    LOOP UNTIL GetButton("", MyDevices(ChosenController).ID) = GetButton.NotFound

    'Start assignment
    DO
        i = i + 1
        IF i > UBOUND(ButtonMap) THEN EXIT DO
        Redo:
        PRINT "PRESS BUTTON FOR '" + RTRIM$(ButtonMap(i).Name) + "'...";

        'Read a button
        ReturnedButton$ = ""
        DO
        LOOP UNTIL GetButton(ReturnedButton$, 0) = GetButton.Found

        'Wait until all buttons in the deviced are released:
        DO
        LOOP UNTIL GetButton("", 0) = GetButton.NotFound

        ButtonMap(i).ID = CVI(ReturnedButton$)
        PRINT
    LOOP
    OPEN "controller.dat" FOR BINARY AS #1
    PUT #1, 1, MyDevices(ChosenController).ID
    PUT #1, , ButtonMap()
    CLOSE #1
ELSE
    OPEN "controller.dat" FOR BINARY AS #1
    GET #1, 1, SavedDevice%
    GET #1, , ButtonMap()
    CLOSE #1
    IF SavedDevice% <> MyDevices(ChosenController).ID THEN
        ON ERROR GOTO FileError
        KILL "controller.dat"
        ON ERROR GOTO 0
        GOTO AssignKeys
    END IF
    FOR i = 1 TO UBOUND(Buttonmap)
        PRINT ButtonMap(i).Name; "="; ButtonMap(i).ID
    NEXT
END IF

PRINT
PRINT "Push START..."
PRINT "(DELETE to reassign keys)"
DO
    IF _KEYHIT = 21248 THEN
        ON ERROR GOTO FileError
        KILL "controller.dat"
        ON ERROR GOTO 0
        GOTO AssignKeys
    END IF
LOOP UNTIL GetButton("START", MyDevices(ChosenController).ID)

'Demo goes here: -----------------------------------------------------------------------------------
RANDOMIZE TIMER
' declare constants
CONST true = 1
CONST false = 0

TYPE StarField_TYPE
    Position_X AS SINGLE
    Position_Y AS INTEGER
    Color AS INTEGER
    RelativeSpeed AS INTEGER
    Char AS STRING * 1
END TYPE

DIM x AS INTEGER, y AS INTEGER
DIM row AS SINGLE
DIM x(1 TO 8) AS INTEGER, y(1 TO 8) AS INTEGER
x = 40
y = 25
Lives = 5
Alive = -1
Boom$ = "--" + CHR$(196) + CHR$(205) + CHR$(254) + CHR$(7) + CHR$(249) + CHR$(250)
max_stars = 100
max_enemies = 10
physics_initialized = false
DIM SHARED Starfield(max_stars) AS StarField_TYPE
DIM SHARED Enemies(max_enemies) AS StarField_TYPE

BoxColor = 10
_PALETTECOLOR 0, _RGB32(61, 61, 61)
_PALETTECOLOR 6, _RGB32(20, 20, 30)
'Wait until all buttons are released:
DO
LOOP UNTIL GetButton("", 0) = GetButton.NotFound
DO
    k$ = INKEY$
    IF k$ = CHR$(27) THEN EXIT DO

    'Grab _BUTTON states using custom function GetButton:
    IF Pause = 0 AND Alive = -1 THEN
        IF GetButton("UP", 0) THEN IF y > 1 THEN y = y - 1
        IF GetButton("DOWN", 0) THEN IF y < 50 THEN y = y + 1
        IF GetButton("LEFT", 0) THEN IF x > 1 THEN x = x - 1
        IF GetButton("RIGHT", 0) THEN IF x < 80 THEN x = x + 1

        IF GetButton("PINK", 0) THEN BoxColor = 13: ColorChange = -1
        IF GetButton("GREEN", 0) THEN BoxColor = 10: ColorChange = -1
        IF GetButton("BLUE", 0) THEN BoxColor = 11: ColorChange = -1
        IF GetButton("RED", 0) THEN BoxColor = 12: ColorChange = -1
    END IF

    IF GetButton("START", 0) THEN
        Pause = NOT Pause
        'Wait until START button is released:
        DO
        LOOP UNTIL GetButton("START", 0) = GetButton.NotFound
    END IF

    'Display routines:
    CLS , 6
    COLOR , 6
    'Star field ------------------------------------------------------
    IF physics_initialized = false THEN
        'actions
        create_at_edge = false
        FOR id = 1 TO max_stars
            Create_star id, create_at_edge
        NEXT

        FOR id = 1 TO max_enemies
            Create_enemy id, create_at_edge
        NEXT
        physics_initialized = true
    END IF

    IF TIMER - move_stars_Last# > .1 AND Pause = 0 AND Alive = -1 THEN
        move_stars_Last# = TIMER
        'move stars in the starfield array
        FOR id = 1 TO max_stars
            'move individual star
            Starfield(id).Position_X = Starfield(id).Position_X - Starfield(id).RelativeSpeed

            'if the star came out of the left edge, create a new star at the right edge
            IF Starfield(id).Position_X < 1 THEN
                create_at_edge = true
                Create_star id, create_at_edge
            END IF
        NEXT
    END IF

    IF TIMER - move_enemies_Last# > .08 AND Pause = 0 AND Alive = -1 THEN
        move_enemies_Last# = TIMER
        'move enemies
        FOR id = 1 TO max_enemies
            'move individual enemy
            Enemies(id).Position_X = Enemies(id).Position_X - Enemies(id).RelativeSpeed

            'if the enemy came out of the left edge or was killed,
            'create a new one at the right edge
            IF Enemies(id).Position_X < 1 THEN
                create_at_edge = true
                Create_enemy id, create_at_edge
            END IF
        NEXT
    END IF

    draw_stars

    IF Alive THEN
        FOR CheckEnemy = 1 TO max_enemies
            IF Enemies(CheckEnemy).Position_X = x AND _
               Enemies(CheckEnemy).Position_Y = _CEIL(row) THEN
                'Death by enemy
                'Explosion sound
                FOR s = 950 TO 810 STEP -1
                    SOUND (RND * 100 + s / 5 + 30), 0.1
                NEXT s
                Alive = 0
                BustEnemy = 0
                ii = 0
                EXIT FOR
            END IF
        NEXT CheckEnemy
    END IF

    'Moving box: -----------------------------------------------------
    IF (x <> prevx OR y <> prevy OR ColorChange = -1) AND Alive = -1 THEN
        prevy = y: prevx = x

        row = y / 2
        IF _CEIL(row) <> row THEN
            char$ = CHR$(223)
        ELSE
            char$ = CHR$(220)
        END IF

        IF ColorChange THEN
            'Animated feedback for button presses
            i = i + 1

            'Laser sound
            IF i = 1 THEN
                FOR s = 1000 TO 700 STEP -25
                    SOUND s, 0.1
                NEXT s
            END IF

            IF i > LEN(Boom$) THEN
                ColorChange = 0
                i = 0
            ELSE
                j = 1
                x(j) = x + i: y(j) = _CEIL(row) + i: j = j + 1
                x(j) = x + i: y(j) = _CEIL(row) - i: j = j + 1
                x(j) = x + i: y(j) = _CEIL(row): j = j + 1
                'x(j) = x - i: y(j) = _CEIL(row) - i: j = j + 1
                'x(j) = x - i: y(j) = _CEIL(row) + i: j = j + 1
                'x(j) = x - i: y(j) = _CEIL(row): j = j + 1
                'x(j) = x: y(j) = _CEIL(row) - i: j = j + 1
                'x(j) = x: y(j) = _CEIL(row) + i: j = j + 1

                FOR drawIt = 1 TO 3
                    Visible = -1
                    IF x(drawIt) < 1 OR x(drawIt) > 80 THEN Visible = 0
                    IF y(drawIt) < 1 OR y(drawIt) > 25 THEN Visible = 0
                    COLOR BoxColor, 7
                    IF Visible THEN
                        _PRINTSTRING (x(drawIt), y(drawIt)), MID$(Boom$, i, 1)
                        FOR CheckEnemy = 1 TO max_enemies
                            IF Enemies(CheckEnemy).Position_X = x(drawIt) AND _
                               Enemies(CheckEnemy).Position_Y = y(drawIt) THEN
                                'Killed an enemy
                                Boom.X = Enemies(CheckEnemy).Position_X
                                Boom.Y = Enemies(CheckEnemy).Position_Y * 2
                                BustEnemy = -1
                                ii = 0
                                Enemies(CheckEnemy).Position_X = 0
                                Points = Points + 50
                                'Explosion sound
                                FOR s = 950 TO 810 STEP -1
                                    SOUND (RND * 100 + s / 5 + 30), 0.1
                                NEXT s
                            END IF
                        NEXT CheckEnemy
                    END IF
                NEXT
                COLOR , 6
            END IF
        END IF
    END IF
    COLOR BoxColor
    _PRINTSTRING (x, _CEIL(row)), char$
    _TITLE STR$(x) + "," + STR$(y)

    IF Pause THEN
        COLOR 15
        PauseMessage$ = " PAUSED "
        _PRINTSTRING (_WIDTH \ 2 - LEN(PauseMessage$) \ 2, _HEIGHT \ 2), PauseMessage$
    END IF

    COLOR 15
    _PRINTSTRING (1, 1), "Lives:" + STR$(Lives)
    _PRINTSTRING (1, 2), "Points:" + STR$(Points)

    IF Alive = 0 OR BustEnemy = -1 THEN
        IF BustEnemy THEN
            bx = x: by = y: brow! = row
            x = Boom.X: y = Boom.Y: row = y / 2
        END IF
        'Explosion animation
        ii = ii + 1
        j = 1
        x(j) = x + ii: y(j) = _CEIL(row) + ii: j = j + 1
        x(j) = x + ii: y(j) = _CEIL(row) - ii: j = j + 1
        x(j) = x + ii: y(j) = _CEIL(row): j = j + 1
        x(j) = x - ii: y(j) = _CEIL(row) - ii: j = j + 1
        x(j) = x - ii: y(j) = _CEIL(row) + ii: j = j + 1
        x(j) = x - ii: y(j) = _CEIL(row): j = j + 1
        x(j) = x: y(j) = _CEIL(row) - ii: j = j + 1
        x(j) = x: y(j) = _CEIL(row) + ii: j = j + 1

        FOR drawIt = 1 TO 8
            Visible = -1
            IF x(drawIt) < 1 OR x(drawIt) > 80 THEN Visible = 0
            IF y(drawIt) < 1 OR y(drawIt) > 25 THEN Visible = 0
            COLOR 11 - ii
            IF Visible THEN
                _PRINTSTRING (x(drawIt), y(drawIt)), MID$(Boom$, ii, 1)
            END IF
        NEXT
        SELECT CASE ii
            CASE 1 TO 4
                COLOR 8
                _PRINTSTRING (x, _CEIL(row)), CHR$(176)
            CASE 5 TO 7
                COLOR 8
                _PRINTSTRING (x, _CEIL(row)), CHR$(15)
            CASE 8
                _PRINTSTRING (x, _CEIL(row)), " "
        END SELECT

        IF BustEnemy THEN
            x = bx: y = by: row = brow!
            IF ii = 8 THEN BustEnemy = 0
        ELSE
            COLOR 15, 4
            PauseMessage$ = " BUSTED "
            _PRINTSTRING (_WIDTH \ 2 - LEN(PauseMessage$) \ 2, _HEIGHT \ 2), PauseMessage$
            IF ii = 9 THEN
                Lives = Lives - 1
                Alive = -1
                physics_initialized = false
                x = 40
                y = 25
                _DELAY 1
            ELSE
                _DELAY .05
            END IF
        END IF
    END IF

    _DISPLAY
    _LIMIT 30
LOOP UNTIL Lives = 0

COLOR 15, 4
PauseMessage$ = " GAME OVER "
_PRINTSTRING (_WIDTH \ 2 - LEN(PauseMessage$) \ 2, _HEIGHT \ 2), PauseMessage$
END

FileError:
PRINT
PRINT "File operation error."
RESUME NEXT

FUNCTION GetButton (Name$, DeviceID AS INTEGER)
    SHARED GetButton.Found, GetButton.NotFound, GetButton.Multiple
    STATIC LastDevice AS INTEGER

    'Initialize SHARED variables used for return codes
    GetButton.NotFound = 0
    GetButton.Found = -1
    GetButton.Multiple = -2

    'DeviceID must always be passed in case there are multiple
    'devices to query; If only one, 0 can be passed in subsequent
    'calls to this function.
    IF DeviceID THEN
        LastDevice = DeviceID
    ELSE
        IF LastDevice = 0 THEN ERROR 5
    END IF

    'Read the device's buffer:
    DO WHILE _DEVICEINPUT(LastDevice): LOOP

    IF LEN(Name$) THEN
        'If button Name$ is passed, we look for that specific ID.
        'If pressed, we return -1
        FOR i = 1 TO UBOUND(ButtonMap)
            IF UCASE$(RTRIM$(ButtonMap(i).Name)) = UCASE$(Name$) THEN
                'Found the requested button's ID.
                'Time to query the controller:
                GetButton = _BUTTON(ButtonMap(i).ID) 'Return result maps to .NotFound = 0 or .Found = -1
                EXIT FUNCTION
            END IF
        NEXT i
    ELSE
        'Otherwise we return every button whose state is -1
        'Return is passed by changing Name$ and GetButton then returns -2
        FOR i = 1 TO _LASTBUTTON(LastDevice)
            IF _BUTTON(i) THEN Name$ = Name$ + MKI$(i)
        NEXT i
        IF LEN(Name$) = 0 THEN EXIT FUNCTION
        IF LEN(Name$) = 2 THEN GetButton = GetButton.Found ELSE GetButton = GetButton.Multiple
    END IF
END FUNCTION

SUB Create_star (id, create_at_edge)
    IF create_at_edge = true THEN
        'will create star at right edge, create values based on that
        Starfield(id).Position_X = 80
    ELSE
        'will create stars scattered to fill the first frame, create values based on that
        Starfield(id).Position_X = INT(RND * 80 + 1)
    END IF
    Starfield(id).Position_Y = INT(RND * 25 + 1)
    'speed in pixels per frame, will be used later to have layers of stars that appear to move at different speeds.
    Starfield(id).RelativeSpeed = INT(RND * 3 + 1)

    SELECT CASE Starfield(id).RelativeSpeed
        CASE 1: Starfield(id).Color = 0: Starfield(id).Char = CHR$(250)
        CASE 2: Starfield(id).Color = 8: Starfield(id).Char = CHR$(249)
        CASE 3: Starfield(id).Color = 7: Starfield(id).Char = CHR$(249)
    END SELECT
END SUB

SUB Create_enemy (id, create_at_edge)
    Enemies(id).Position_X = 80 + INT(RND * 40 + 1)
    Enemies(id).Position_Y = INT(RND * 25 + 1)
    Enemies(id).RelativeSpeed = 1 'INT(RND * 2 + 1)
END SUB

SUB draw_stars
    SHARED max_stars
    SHARED max_enemies
    FOR id = 1 TO max_stars
        Visible = -1
        IF Starfield(id).Position_X < 1 OR Starfield(id).Position_X > 80 THEN Visible = 0
        IF Starfield(id).Position_Y < 1 OR Starfield(id).Position_Y > 25 THEN Visible = 0
        IF Visible THEN
            COLOR Starfield(id).Color
            _PRINTSTRING (Starfield(id).Position_X, Starfield(id).Position_Y), Starfield(id).Char
        END IF
    NEXT

    'enemies too
    FOR id = 1 TO max_enemies
        Visible = -1
        IF Enemies(id).Position_X < 1 OR Enemies(id).Position_X > 80 THEN Visible = 0
        IF Enemies(id).Position_Y < 1 OR Enemies(id).Position_Y > 25 THEN Visible = 0
        IF Visible THEN
            COLOR 14
            _PRINTSTRING (Enemies(id).Position_X, Enemies(id).Position_Y), CHR$(17)
        END IF
    NEXT
END SUB

