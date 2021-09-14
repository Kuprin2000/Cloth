//configuration globals
let number_of_iterations = 20;      // number of iterations while simulation
let framerate = 25;                 // framerate
let frame_time = 1000 / framerate;

"use strict";

// vertex shader
const VSHADER_SOURCE =
    'attribute vec4 a_Position;\n' +
    'attribute vec4 a_FragColor;\n' +
    'varying vec4 v_FragColor;\n' +
    'void main() \n' +
    '{\n' +
    '   gl_Position = a_Position;\n' +
    '   gl_PointSize = 5.0;\n' +
    '   v_FragColor = a_FragColor;\n' +
    '}\n';

// framgent shader
const FSHADER_SOURCE =
    'precision highp float;\n' +
    'varying vec4 v_FragColor;\n' +
    'void main() \n' +
    '{\n' +
    '   gl_FragColor = v_FragColor;\n' +
    '}\n';

// cloth simulation class
class ClothSimulator {
    // constructor
    constructor(n_text, m_text, distance_text, gravity_checkbox, show_nodes_checkbox, old_coord, coord, canvas_size, gl) {
        // initialize variables
        this.time_step = frame_time;
        let n = eval(n_text.value);
        let m = eval(m_text.value);
        this.n = n;
        this.m = m;
        this.need_gravity = gravity_checkbox.checked;
        if (this.need_gravity == 1)
            this.gravity = new Float32Array([0, -1, 0]);
        else
            this.gravity = new Float32Array([0, 0, 0]);
        this.distance_between_nodes = eval(distance_text.value);
        this.show_nodes = show_nodes_checkbox.checked;
        this.old_coord = old_coord;
        this.coord = coord;
        this.canvas_size = canvas_size;
        this.gl = gl;

        // get pointers to interfase objects
        this.distance_text = distance_text;
        this.n_text = n_text;
        this.m_text = m_text;
        this.need_gravity_checkbox = gravity_checkbox;
        this.show_nodes_checkbox = show_nodes_checkbox;

        // initialize stress array
        this.stress = new Float32Array(this.m * this.n);
        this.initializeStress();

        // initialize array that stores how many edges each node has
        this.edges_per_node = new Array(this.m * this.n);
        this.initializeEdgesPerNode();

        // initialize color array
        this.color = new Float32Array(3 * this.m * this.n);

        // initialize index array which to draw edges
        this.edge_index = new Uint16Array((this.m * (this.n - 1) + this.n * (this.m - 1)) * 2);
        this.initializeEdgeIndex();

        // initialize vertex array to draw nodes
        this.node_index = new Uint16Array(this.n * this.m);
        this.initializeNodeIndex();

        // set data about vertcles that are locked at the begining
        this.initializeLockedNodes();

        // initislize buffers
        this.index_buffer = this.gl.createBuffer();
        this.data_buffer = this.gl.createBuffer();
        let size;
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
        if (this.show_nodes == false) {
            size = this.edge_index.BYTES_PER_ELEMENT * this.edge_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.edge_index);
        }
        else {
            size = this.node_index.BYTES_PER_ELEMENT * this.node_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.node_index);
        }
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.data_buffer);
        size = this.coord.BYTES_PER_ELEMENT * this.coord.length + this.color.BYTES_PER_ELEMENT * this.color.length;
        this.gl.bufferData(this.gl.ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
        this.a_Position = this.gl.getAttribLocation(this.gl.program, 'a_Position');
        this.a_FragColor = this.gl.getAttribLocation(this.gl.program, 'a_FragColor');
        this.gl.enableVertexAttribArray(this.a_Position);
        this.gl.enableVertexAttribArray(this.a_FragColor);
        this.gl.vertexAttribPointer(this.a_Position, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribPointer(this.a_FragColor, 3, this.gl.FLOAT, false, 0, this.coord.BYTES_PER_ELEMENT * this.coord.length);

        // start simualtion
        setInterval(this.simulationStep.bind(this), this.time_step);
    }

    // initialize index array which to draw nodes
    initializeNodeIndex() {
        for (let i = 0; i < this.n * this.m; ++i)
            this.node_index[i] = i;
    }

    // initialize index array which to draw edges
    initializeEdgeIndex() {
        let counter = 0;
        for (let i = 0; i < this.n; ++i)                            // iterate over nodes
        {
            for (let j = 0; j < this.m; ++j) {
                if (i != this.n - 1 && j != this.m - 1) {           // if the node is not from the last row 
                    this.edge_index[counter] = i * this.m + j;      // and not from the last column we add to
                    ++counter                                       // the array edge that goes down and the edge       
                    this.edge_index[counter] = i * this.m + j + 1;  // that goes to the right
                    ++counter;
                    this.edge_index[counter] = i * this.m + j;
                    ++counter;
                    this.edge_index[counter] = (i + 1) * this.m + j;
                    ++counter;
                }
                if (i != this.n - 1 && j == this.m - 1) {           // similar to the rest of cases
                    this.edge_index[counter] = i * this.m + j;
                    ++counter;
                    this.edge_index[counter] = (i + 1) * this.m + j;
                    ++counter;
                }
                if (i == this.n - 1 && j != this.m - 1) {
                    this.edge_index[counter] = i * this.m + j;
                    ++counter
                    this.edge_index[counter] = i * this.m + j + 1;
                    ++counter;
                }
            }
        }
    }

    // initialize positions of the nodes
    initializeCoords() {
        // deltas between nodes
        let row_delta = 2 * this.m;
        let column_delta = 2;

        // top-left node has coordinates x=-0.45*(m-1)*distance_between_nodes,
        // y=0. Positions of the other nodes are based on this node
        for (let i = 0; i < this.n; ++i) {                                                          
            for (let j = 0; j < this.m; ++j) {                                                       
                this.coord[i * row_delta + j * column_delta] = (-0.45 * (this.m - 1) + j) * this.distance_between_nodes;
                this.coord[i * row_delta + j * column_delta + 1] = 1 - i * this.distance_between_nodes;
                this.old_coord[i * row_delta + j * column_delta] = this.coord[i * row_delta + j * column_delta];
                this.old_coord[i * row_delta + j * column_delta + 1] = this.coord[i * row_delta + j * column_delta + 1];
            }
        }
    }

    // initialize edges stress
    initializeStress() {
        for (let i = 0; i < this.m * this.n; ++i)
            this.stress[i] = 0;
    }

    // initialize how many edges are connected to the each node
    initializeEdgesPerNode() {
        let row_delta = this.m;

        for (let i = 0; i < this.m; ++i) {
            if (i == 0 || i == this.m - 1) {
                this.edges_per_node[i] = 2;
                this.edges_per_node[(this.n - 1) * row_delta + i] = 2;
            }
            else {
                this.edges_per_node[i] = 3;
                this.edges_per_node[(this.n - 1) * row_delta + i] = 3
            }
        }

        for (let i = 1; i < this.n - 1; ++i) {
            this.edges_per_node[i * row_delta] = 3;
            this.edges_per_node[i * row_delta + this.m - 1] = 3;
        }

        for (let i = 1; i < this.n - 1; ++i) {
            for (let j = 1; j < this.m - 1; ++j) {
                this.edges_per_node[i * row_delta + j] = 4;
            }
        }
    }

    // initialize data about nodes that are locked by the default
    initializeLockedNodes() {
        this.selected_node = -1;                                    // we store data about locked nodes in this.locked_nodes array.
        this.current_mouse_x = 0;                                   // The way we store data is:
        this.current_mouse_y = 0;                                   // this.locked_nodes[i] = index
        this.locked_nodes = new Array();                            // this.locked_nodes[i + 1] = x_coord
        this.locked_nodes.push(0);                                  // this.locked_nodes[i + 2] = y_coord, i%3=0
        this.locked_nodes.push(-0.45 * (this.m - 1) * this.distance_between_nodes);
        this.locked_nodes.push(1);
        this.locked_nodes.push((this.m - 1) * 2);
        this.locked_nodes.push(0.45 * (this.m - 1) * this.distance_between_nodes);
        this.locked_nodes.push(1);
    }

    // change numder of nodex along x axis
    setN(n) {
        this.n = n;

        // initialization like in the constructor
        this.coord = new Float32Array(this.n * this.m * 2);
        this.old_coord = new Float32Array(this.n * this.m * 2);
        this.color = new Float32Array(3 * this.m * this.n);

        this.initializeCoords();

        this.stress = new Float32Array(this.m * this.n);
        this.initializeStress();

        this.edges_per_node = new Array(this.m * this.n);
        this.initializeEdgesPerNode();

        this.edge_index = new Uint16Array((this.m * (this.n - 1) + this.n * (this.m - 1)) * 2);
        this.initializeEdgeIndex();

        this.node_index = new Uint16Array(this.n * this.m);
        this.initializeNodeIndex();

        this.locked_nodes = new Array();
        this.initializeLockedNodes();

        this.gl.deleteBuffer(this.index_buffer);
        this.gl.deleteBuffer(this.data_buffer);
        this.index_buffer = this.gl.createBuffer();
        this.data_buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
        let size;
        if (this.show_nodes == false) {
            size = this.edge_index.BYTES_PER_ELEMENT * this.edge_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.edge_index);
        }
        else {
            size = this.node_index.BYTES_PER_ELEMENT * this.node_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.node_index);
        }
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.data_buffer);
        size = this.coord.BYTES_PER_ELEMENT * this.coord.length + this.color.BYTES_PER_ELEMENT * this.color.length;
        this.gl.bufferData(this.gl.ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.a_Position, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribPointer(this.a_FragColor, 3, this.gl.FLOAT, false, 0, this.coord.BYTES_PER_ELEMENT * this.coord.length);
    }

    // change numder of nodex along y axis
    setM(m) {
        this.m = m;

        // initialization like in the constructor
        this.coord = new Float32Array(this.n * this.m * 2);
        this.old_coord = new Float32Array(this.n * this.m * 2);
        this.color = new Float32Array(3 * this.m * this.n);

        this.initializeCoords();

        this.stress = new Float32Array(this.m * this.n);
        this.initializeStress();

        this.edges_per_node = new Array(this.m * this.n);
        this.initializeEdgesPerNode();

        this.edge_index = new Uint16Array((this.m * (this.n - 1) + this.n * (this.m - 1)) * 2);
        this.initializeEdgeIndex();

        this.node_index = new Uint16Array(this.n * this.m);
        this.initializeNodeIndex();

        this.locked_nodes = new Array();
        this.initializeLockedNodes();

        this.gl.deleteBuffer(this.index_buffer);
        this.gl.deleteBuffer(this.data_buffer);
        this.index_buffer = this.gl.createBuffer();
        this.data_buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
        let size;
        if (this.show_nodes == false) {
            size = this.edge_index.BYTES_PER_ELEMENT * this.edge_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.edge_index);
        }
        else {
            size = this.node_index.BYTES_PER_ELEMENT * this.node_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.node_index);
        }
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.data_buffer);
        size = this.coord.BYTES_PER_ELEMENT * this.coord.length + this.color.BYTES_PER_ELEMENT * this.color.length;
        this.gl.bufferData(this.gl.ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.a_Position, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribPointer(this.a_FragColor, 3, this.gl.FLOAT, false, 0, this.coord.BYTES_PER_ELEMENT * this.coord.length);
    }

    // switch gravity
    setNeedGravity(need_gravity) {
        this.need_gravity = need_gravity;
        if (need_gravity == 1)
            this.gravity = new Float32Array([0, -1, 0]);
        else
            this.gravity = new Float32Array([0, 0, 0]);
    }

    // change distance between nodes
    setDistanceBetweenNodes(distance_between_nodes) {

        this.distance_between_nodes = distance_between_nodes;

        // initialization like in the constructor
        this.coord = new Float32Array(this.n * this.m * 2);
        this.old_coord = new Float32Array(this.n * this.m * 2);

        this.initializeCoords();

        this.locked_nodes = new Array();
        this.initializeLockedNodes();

        this.stress = new Float32Array(this.m * this.n);
        this.initializeStress();

        this.gl.deleteBuffer(this.data_buffer);
        this.data_buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.data_buffer);
        let size = this.coord.BYTES_PER_ELEMENT * this.coord.length + this.color.BYTES_PER_ELEMENT * this.color.length;
        this.gl.bufferData(this.gl.ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.a_Position, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribPointer(this.a_FragColor, 3, this.gl.FLOAT, false, 0, this.coord.BYTES_PER_ELEMENT * this.coord.length);
    }

    // change show nodes and edges / show only nodes
    setShowNodes(show_nodes) {
        this.show_nodes = show_nodes;

        // delete old index buffer
        this.gl.deleteBuffer(this.index_buffer);
        this.index_buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);

        // reintialize index buffer 
        if (this.show_nodes == false) {
            let size = this.edge_index.BYTES_PER_ELEMENT * this.edge_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.edge_index);
        }
        else {
            let size = this.node_index.BYTES_PER_ELEMENT * this.node_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.node_index);
        }
    }

    // handle mouse click
    mouseDown(mouse_event) {
        // left button
        if (mouse_event.which == 1) {
            let click_x = (mouse_event.clientX / this.canvas_size * 2 - 1.02);
            let click_y = ((this.canvas_size - mouse_event.clientY) / this.canvas_size * 2 - 0.98);

            let coord_row_delta = 2 * this.m;
            let coord_column_delta = 2;

            let res_i = -1, res_j = -1;

            // find node user has clicked and write it's index to this.selected_node
            for (let i = 0; i < this.n && res_i == -1; ++i) {
                for (let j = 0; j < this.m && res_i == -1; ++j) {
                    if (Math.abs(this.coord[i * coord_row_delta + j * coord_column_delta] - click_x) < this.distance_between_nodes / 2
                        &&
                        Math.abs(this.coord[i * coord_row_delta + j * coord_column_delta + 1] - click_y) < this.distance_between_nodes / 2) {
                        res_i = i;
                        res_j = j;
                        this.selected_node = res_i * coord_row_delta + res_j * coord_column_delta;
                        this.current_mouse_x = click_x;
                        this.current_mouse_y = click_y;
                    }
                }
            }
        }

        // if user pressed right button and some node is selected
        // then lock this node
        if (mouse_event.which == 3 && this.selected_node != -1) {
            this.locked_nodes.push(this.selected_node);
            this.locked_nodes.push(this.current_mouse_x);
            this.locked_nodes.push(this.current_mouse_y);

            this.mouseUp(mouse_event);
        }
    }

    // handle mouse up
    mouseUp(mouse_event) {
        // if user released left button and there some node is selected, then 
        // clear selection
        if (mouse_event.which == 1 && this.selected_node != -1)
            this.selected_node = -1;
    }

    // handle mouse move
    mouseMoved(mouse_event) {
        // if ane node is selected
        if (this.selected_node != -1) {
            let mouse_x = (mouse_event.clientX / this.canvas_size * 2 - 1.02);
            let mouse_y = ((this.canvas_size - mouse_event.clientY) / this.canvas_size * 2 - 0.98);

            let selected_node_i = Math.trunc(this.selected_node / 2 / this.m);
            let selected_node_j = (this.selected_node / 2) % this.m;

            let flag = false;
            let locked_node_i, locked_node_j, delta_i, delta_j, delta_x, delta_y;

            // we should check if user moved selected node to far from fixed nodes. Iterate over array
            // of locked nodes. We should remember how we store data about locked nodes:
            // this.locked_nodes[i] = index
            // this.locked_nodes[i + 1] = x_coord 
            // this.locked_nodes[i + 2]= y_coord, i%3=0
            for (let i = 0; i < this.locked_nodes.length; i += 3) {
                locked_node_i = Math.trunc(this.locked_nodes[i] / 2 / this.m);      // get indices of the current locked node
                locked_node_j = (this.locked_nodes[i] / 2) % this.m;

                delta_i = Math.abs(selected_node_i - locked_node_i);                // caclulate index delta               
                delta_j = Math.abs(selected_node_j - locked_node_j);
                delta_x = Math.abs(this.locked_nodes[i + 1] - mouse_x);             // caclulate coordinates delta
                delta_y = Math.abs(this.locked_nodes[i + 2] - mouse_y);

                // check if nodes are not too far from each other. If they are set the flag
                if (Math.sqrt(delta_i * delta_i + delta_j * delta_j) * 2 * this.distance_between_nodes < Math.sqrt(delta_x * delta_x + delta_y * delta_y)
                    &&
                    delta_i + delta_j != 0)
                    flag = true;
            }

            // if selected node is not too far from locked nodes
            if (flag == false) {
                this.coord[this.selected_node] = mouse_x;
                this.coord[this.selected_node + 1] = mouse_y;

                flag = false;
                let i = 0;

                // check if selected node is one of the locked nodes
                while (i < this.locked_nodes.length && flag == false) {
                    if (this.locked_nodes[i] == this.selected_node) flag = true;
                    i += 3;
                }
                i -= 3;

                // if it is update information about the locked node
                if (flag == true) {
                    this.locked_nodes[i + 1] = mouse_x;
                    this.locked_nodes[i + 2] = mouse_y;
                }

                this.current_mouse_x = mouse_x;
                this.current_mouse_y = mouse_y;
            }
        }
    }

    // Verlet integration
    verletIntegration() {
        let row_delta = 2 * this.m;
        let column_delta = 2;

        let buffer, coord, old_coord;

        // iterate over nodes array
        for (let i = 0; i < this.n; ++i) {
            for (let j = 0; j < this.m; ++j) {
                for (let k = 0; k < 2; ++k) {
                    // save current position of the node
                    buffer = this.coord[i * row_delta + j * column_delta + k];
                    coord = this.coord[i * row_delta + j * column_delta + k];

                    // save previoud position of the node
                    old_coord = this.old_coord[i * row_delta + j * column_delta + k];

                    // calculate new position of the node. 0.99 coefficient makes
                    //  the movement stop in course of time 
                    coord = coord + 0.99 * (coord - old_coord) + this.gravity[k] *
                        this.time_step / 1000 * this.time_step / 1000;

                    // set new position of the node
                    this.coord[i * row_delta + j * column_delta + k] = coord;
                    this.old_coord[i * row_delta + j * column_delta + k] = buffer;
                }
            }
        }
    }

    // regulate distances between nodes and check if nodes are outside rendering area
    satisfyConstraints() {
        let row_delta = 2 * this.m;
        let column_delta = 2;

        //delta_length is a distance between current nodes
        //diff1 and diff2 are deformation coefficients of the edge
        //delta is a vector betveen nodes
        //node_movement is a vector of translation for the nodes
        let delta_length, diff1, diff2;
        let delta = new Float32Array(2);
        let node_movement = new Float32Array(2);

        // reset stress in all nodes
        this.initializeStress();

        // checks of distances is performed in several iterations. Number of iterarions can be set using
        // the global variable
        for (let l = 0; l < number_of_iterations; ++l) {
            // iterate over nodes and move them if they are outside rendering area
            for (let i = 0; i < this.n; ++i) {
                for (let j = 0; j < this.m; ++j) {
                    this.coord[i * row_delta + j * column_delta] = Math.min(this.coord[i * row_delta + j * column_delta], 1);
                    this.coord[i * row_delta + j * column_delta] = Math.max(this.coord[i * row_delta + j * column_delta], -1);
                    this.coord[i * row_delta + j * column_delta + 1] = Math.min(this.coord[i * row_delta + j * column_delta + 1], 1);
                    this.coord[i * row_delta + j * column_delta + 1] = Math.max(this.coord[i * row_delta + j * column_delta + 1], -1);
                }
            }

             // iterate over nodes again
            for (let i = 0; i < this.n; ++i) {
                for (let j = 0; j < this.m; ++j) {
                    // if current node is not in the last row and is not in the last column
                    if (i != this.n - 1 && j != this.m - 1) {
                        // calculate coordinate deltas between current node and it's right neighbour
                        delta[0] = this.coord[i * row_delta + j * column_delta] - this.coord[i * row_delta + (j + 1) * column_delta];
                        delta[1] = this.coord[i * row_delta + j * column_delta + 1] - this.coord[i * row_delta + (j + 1) * column_delta + 1];

                        // calculate distance between these nodes
                        delta_length = delta[0] * delta[0] + delta[1] * delta[1];
                        delta_length = Math.sqrt(delta_length);

                        // calculate deformation coefficient of the edge between the nodes
                        diff1 = (delta_length - this.distance_between_nodes) / delta_length;

                        // move nodes to make distance between them correct
                        for (let k = 0; k < 2; ++k) {
                            node_movement[k] = 0.5 * diff1 * delta[k];
                            this.coord[i * row_delta + j * column_delta + k] -= node_movement[k];
                            this.coord[i * row_delta + (j + 1) * column_delta + k] += node_movement[k];
                        }

                        // calculate coordinate deltas between current node and it's down neighbour
                        delta[0] = this.coord[i * row_delta + j * column_delta] - this.coord[(i + 1) * row_delta + j * column_delta];
                        delta[1] = this.coord[i * row_delta + j * column_delta + 1] - this.coord[(i + 1) * row_delta + j * column_delta + 1];

                        // calculate distance between these nodes
                        delta_length = delta[0] * delta[0] + delta[1] * delta[1];
                        delta_length = Math.sqrt(delta_length);

                        // calculate deformation coefficient of the edge between the nodes
                        diff2 = (delta_length - this.distance_between_nodes) / delta_length;

                         // move nodes to make distance between them correct
                        for (let k = 0; k < 2; ++k) {
                            node_movement[k] = 0.5 * diff2 * delta[k];
                            this.coord[i * row_delta + j * column_delta + k] -= node_movement[k];
                            this.coord[(i + 1) * row_delta + j * column_delta + k] += node_movement[k];
                        }
                    }

                    // the same for the rest of the cases
                    if (i != this.n - 1 && j == this.m - 1) {
                        delta[0] = this.coord[i * row_delta + j * column_delta] - this.coord[(i + 1) * row_delta + j * column_delta];
                        delta[1] = this.coord[i * row_delta + j * column_delta + 1] - this.coord[(i + 1) * row_delta + j * column_delta + 1];

                        delta_length = delta[0] * delta[0] + delta[1] * delta[1];
                        delta_length = Math.sqrt(delta_length);

                        diff1 = (delta_length - this.distance_between_nodes) / delta_length;

                        for (let k = 0; k < 2; ++k) {
                            node_movement[k] = 0.5 * diff1 * delta[k];
                            this.coord[i * row_delta + j * column_delta + k] -= node_movement[k];
                            this.coord[(i + 1) * row_delta + j * column_delta + k] += node_movement[k];
                        }
                    }

                    if (i == this.n - 1 && j != this.m - 1) {
                        delta[0] = this.coord[i * row_delta + j * column_delta] - this.coord[i * row_delta + (j + 1) * column_delta];
                        delta[1] = this.coord[i * row_delta + j * column_delta + 1] - this.coord[i * row_delta + (j + 1) * column_delta + 1];

                        delta_length = delta[0] * delta[0] + delta[1] * delta[1];
                        delta_length = Math.sqrt(delta_length);

                        diff1 = (delta_length - this.distance_between_nodes) / delta_length;

                        for (let k = 0; k < 2; ++k) {
                            node_movement[k] = 0.5 * diff1 * delta[k];
                            this.coord[i * row_delta + j * column_delta + k] -= node_movement[k];
                            this.coord[i * row_delta + (j + 1) * column_delta + k] += node_movement[k];
                        }
                    }

                    // if it is the last iteration calculate stress in the node and
                    // it's neighbours
                    if (l == number_of_iterations - 1)
                        this.calculateStress(i, j, diff1, diff2);
                }
            }

            // if some node is selected return it to the mouse position
            if (this.selected_node != -1) {
                this.coord[this.selected_node] = this.current_mouse_x;
                this.coord[this.selected_node + 1] = this.current_mouse_y;
            }

            // return locked nodes to their places
            for (let i = 0; i < this.locked_nodes.length; i += 3) {
                this.coord[this.locked_nodes[i]] = this.locked_nodes[i + 1];
                this.coord[this.locked_nodes[i] + 1] = this.locked_nodes[i + 2];
            }
        }

        // calculate colours of the nodes based on the stress
        this.calculateColors();
    }

    // calculate stress in all nodes
    calculateStress(i, j, diff1, diff2) {
        diff1 = Math.abs(diff1);
        diff2 = Math.abs(diff2);

        let row_delta = this.m;

        // if node is not in the last row and is not in the last column we should
        // update stress in this node and in it's neighbours down and right
        if (i != this.n - 1 && j != this.m - 1) {
            this.stress[i * row_delta + j] += 1. / this.edges_per_node[i * row_delta + j] * diff1;
            this.stress[i * row_delta + j] += 1. / this.edges_per_node[i * row_delta + j] * diff2;
            this.stress[i * row_delta + j + 1] += 1. / this.edges_per_node[i * row_delta + j + 1] * diff1;
            this.stress[(i + 1) * row_delta + j] += 1. / this.edges_per_node[(i + 1) * row_delta + j] * diff2;
        }

        // similar for the rest of cases
        if (i != this.n - 1 && j == this.m - 1) {
            this.stress[i * row_delta + j] += 1. / this.edges_per_node[i * row_delta + j] * diff1;
            this.stress[(i + 1) * row_delta + j] += 1. / this.edges_per_node[(i + 1) * row_delta + j] * diff1;
        }

        if (i == this.n - 1 && j != this.m - 1) {
            this.stress[i * row_delta + j] += 1. / this.edges_per_node[i * row_delta + j] * diff1;
            this.stress[i * row_delta + j + 1] += 1. / this.edges_per_node[i * row_delta + j + 1] * diff1;
        }
    }

    // calculate colours of the nodes
    calculateColors() {
        // find node with the maximum stress
        let max_stress = 0;
        for (let i = 0; i < this.n * this.m; ++i) {
            if (this.stress[i] > max_stress) max_stress = this.stress[i];
        }

        // normilize coefficient
        let coeff = 1 / max_stress;

        let color_row_delta = 3 * this.m;
        let color_column_delta = 3;

        // iterate over colours array and set colour between blue and red based on stress value
        for (let i = 0; i < this.n; ++i) {
            for (let j = 0; j < this.m; ++j) {
                this.color[i * color_row_delta + j * color_column_delta] = this.stress[i * this.m + j] * coeff;
                this.color[i * color_row_delta + j * color_column_delta + 1] = 0;
                this.color[i * color_row_delta + j * color_column_delta + 2] = 1 - this.stress[i * this.m + j] * coeff;
            }
        }
    }

    // draw frame
    drawFrame() {
        // write down coordinates
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.coord);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, this.coord.BYTES_PER_ELEMENT * this.coord.length, this.color);

        // clear screen
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.clear(this.gl.DEPTH_BUFFER_BIT);

        // if we should draw only nodes
        if (this.show_nodes == false)
            this.gl.drawElements(this.gl.LINES, (this.m * (this.n - 1) + this.n * (this.m - 1)) * 2, this.gl.UNSIGNED_SHORT, 0);

        // if we should draw nodes and edges
        else
            this.gl.drawElements(this.gl.POINTS, this.n * this.m, this.gl.UNSIGNED_SHORT, 0);

    }

    // simulation step
    simulationStep() {
        // check if user has changed any value
        if (eval(this.n_text.value) != this.n) this.setN(eval(this.n_text.value));
        if (eval(this.m_text.value) != this.m) this.setM(eval(this.m_text.value));
        if (eval(this.distance_text.value) != this.distance_between_nodes) this.setDistanceBetweenNodes(eval(this.distance_text.value));
        if (this.need_gravity_checkbox.checked != this.need_gravity) this.setNeedGravity(this.need_gravity_checkbox.checked);
        if (this.show_nodes_checkbox.checked != this.show_nodes) this.setShowNodes(this.show_nodes_checkbox.checked);

        // Verlet integration
        this.verletIntegration();

        // regulate distances between nodes and check if nodes are outside rendering area
        this.satisfyConstraints();

        // draw the frame
        this.drawFrame();
    }
}

// main function
function main() {
    // get pointers to the elements of the interface
    const canvas = document.getElementById('webgl');
    const n_text = document.getElementById("n_text");
    const m_text = document.getElementById("m_text");
    const frame_text = document.getElementById("frame_text");
    const distance_text = document.getElementById("distance_text");
    const gravity_checkbox = document.getElementById("gravity_checkbox");
    const show_nodes_checkbox = document.getElementById("show_nodes_checkbox");

    // get draw context
    const gl = getWebGLContext(canvas);
    initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE);

    // get data from interface
    let n = eval(n_text.value);
    let m = eval(m_text.value);
    let distance_between_nodes = eval(distance_text.value);
    let canvas_size = canvas.width;

    // initialize coords arrays
    let coord = new Float32Array(n * m * 2);
    let old_coord = new Float32Array(n * m * 2);

    let row_delta = 2 * m;
    let column_delta = 2;

    for (let i = 0; i < n; ++i) {
        for (let j = 0; j < m; ++j) {
            coord[i * row_delta + j * column_delta] = (-0.45 * (m - 1) + j) * distance_between_nodes;
            coord[i * row_delta + j * column_delta + 1] = 1 - i * distance_between_nodes;
            old_coord[i * row_delta + j * column_delta] = coord[i * row_delta + j * column_delta];
            old_coord[i * row_delta + j * column_delta + 1] = coord[i * row_delta + j * column_delta + 1];
        }
    }

    // create object to simulate cloth
    frame_drawer = new ClothSimulator(n_text, m_text, distance_text, gravity_checkbox, show_nodes_checkbox, old_coord, coord, canvas_size, gl);

    // set events handlers
    canvas.onmousedown = function (mouse_event) { frame_drawer.mouseDown(mouse_event) };
    canvas.onmouseup = function (mouse_event) { frame_drawer.mouseUp(mouse_event) };
    canvas.onmousemove = function (mouse_event) { frame_drawer.mouseMoved(mouse_event) };
}