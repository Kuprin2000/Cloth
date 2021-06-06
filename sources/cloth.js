//тестовое задание

//глобальные переменные
var number_of_iterations = 20;  //количество итераций при моделировании ткани
var frame_time = 1000 / 25;     //время одного кадра

"use strict";

//вершинный шейдер
const VSHADER_SOURCE =
'attribute vec4 a_Position;\n' +
'attribute vec4 a_FragColor;\n' +
'varying vec4 v_FragColor;\n' +
'void main() \n' +
'{\n' +
'gl_Position = a_Position;\n' +
'gl_PointSize = 5.0;\n' +
'v_FragColor = a_FragColor;\n' +
'}\n';

//фрагментный шейдер
const FSHADER_SOURCE =
'precision highp float;\n' +
'varying vec4 v_FragColor;\n' +
'void main() \n' +
'{\n' +
'  gl_FragColor = v_FragColor;\n' +
'}\n';

//класс симуляции ткани
class ClothSimulator
{
    //конструктор
    constructor(n_text, m_text, distance_text, gravity_checkbox, show_nodes_checkbox, old_coord, coord, canvas_size, gl)
    {
        //инициализируем переменные
        this.time_step = frame_time;
        let n = eval(n_text.value);
        let m = eval(m_text.value);
        this.n = n;
        this.m = m;
        this.need_gravity = gravity_checkbox.checked;
        if (this.need_gravity == 1)
        {
            this.gravity = new Float32Array([0, -1, 0]);
        }
        else
        {
            this.gravity = new Float32Array([0, 0, 0]);
        }
        this.distance_between_nodes = eval(distance_text.value);
        this.show_nodes = show_nodes_checkbox.checked;
        this.old_coord = old_coord;
        this.coord = coord;
        this.canvas_size = canvas_size;
        this.gl = gl;

        //сохраняем указатели на обьекты интерфейса
        this.distance_text = distance_text;
        this.n_text = n_text;
        this.m_text = m_text;
        this.need_gravity_checkbox = gravity_checkbox;
        this.show_nodes_checkbox = show_nodes_checkbox;

        //инициализируем массив напряжений
        this.stress = new Float32Array(this.m * this.n);
        this.initializeStress();

        //инициализируем массив с информацией о том, сколько смежных ребер у каждой вершины
        this.edges_per_node = new Array(this.m * this.n);
        this.initializeEdgesPerNode();

        //инициализируем массив цветов
        this.color = new Float32Array(3 * this.m * this.n);

        //инициализируем индексный массив для рисования ребер 
        this.edge_index = new Uint16Array((this.m * (this.n - 1) + this.n * (this.m - 1)) * 2);
        this.initializeEdgeIndex();

        //инициализируем индексный массив для рисования вершин 
        this.node_index = new Uint16Array(this.n * this.m);
        this.initializeNodeIndex();

        //заполняем информацию о закрепленных изначально вершинах
        this.initializeLockedNodes();

        //работаем с буфферами для отрисовки
        this.index_buffer = this.gl.createBuffer();
        this.data_buffer = this.gl.createBuffer();
        let size;
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
        if (this.show_nodes == false)
        {
            size = this.edge_index.BYTES_PER_ELEMENT * this.edge_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.edge_index);
        }
        else
        {
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

        //запускаем симуляцию с заданной длительностью одного кадра
        setInterval(this.simulationStep.bind(this), this.time_step);
    }

    //функция, инициализирующая индексный массив для рисования вершин 
    initializeNodeIndex()
    {
        for (let i = 0; i < this.n * this.m; ++i)                   //просто перенумеровываем вершины
        {
            this.node_index[i] = i;
        }
    }

    //функция, инициализирующая индексный массив для рисования ребер 
    initializeEdgeIndex()
    {
        let counter = 0;
        for (let i = 0; i < this.n; ++i)                            //обходим все узлы
        {
            for (let j = 0; j < this.m; ++j)
            {
                if (i != this.n - 1 && j != this.m - 1)             //если это узел не из последней строки и не 
                {                                                   //из последнего столбца, то записываем в массив
                    this.edge_index[counter] = i * this.m + j;      //индексов ребро, идущее от этой вершины вниз и 
                    ++counter                                       //ребро, идущее от этой вершины вправо
                        this.edge_index[counter] = i * this.m + j + 1;
                    ++counter;
                    this.edge_index[counter] = i * this.m + j;
                    ++counter;
                    this.edge_index[counter] = (i + 1) * this.m + j;
                    ++counter;
                }
                if (i != this.n - 1 && j == this.m - 1)             //если это узел из последнего столбца, записываем
                {                                                   //в массив только ребро, идущее из этого узла
                    this.edge_index[counter] = i * this.m + j;      //вниз
                    ++counter;
                    this.edge_index[counter] = (i + 1) * this.m + j;
                    ++counter;
                }
                if (i == this.n - 1 && j != this.m - 1)             //если это узел из последней строки, записываем 
                {                                                   //в массив только ребро, идущее из этого узла                                        
                    this.edge_index[counter] = i * this.m + j;      //вправо
                    ++counter
                        this.edge_index[counter] = i * this.m + j + 1;
                    ++counter;
                }
            }
        }
    }

    //функция, инициализирующая начальные координаты узлов
    initializeCoords()
    {
        //вычисляем смещения индесов по строке и по столбцу
        let row_delta = 2 * this.m;
        let column_delta = 2;

        for (let i = 0; i < this.n; ++i)                            //левому-верхнему узлу сетки назначаются коррдинаты 
        {                                                           //x=-0.45*(m-1)*расстояние_между_ребрами y=0, а 
            for (let j = 0; j < this.m; ++j)                        //остальные узлы располагаются с равномерныи шагом
            {                                                       //от него 
                this.coord[i * row_delta + j * column_delta] = (-0.45 * (this.m - 1) + j) * this.distance_between_nodes;
                this.coord[i * row_delta + j * column_delta + 1] = 1 - i * this.distance_between_nodes;
                this.old_coord[i * row_delta + j * column_delta] = this.coord[i * row_delta + j * column_delta];
                this.old_coord[i * row_delta + j * column_delta + 1] = this.coord[i * row_delta + j * column_delta + 1];
            }
        }
    }

    //функция, инизиализирующая начальное напряжение в узлах
    initializeStress()
    {
        for (let i = 0; i < this.m * this.n; ++i)                   //в начале каждого кадра напряжение равно нулю
        {
            this.stress[i] = 0;
        }
    }

    //функция, инициализирущая массив с информацией о том, сколько смежных ребер у каждой вершины
    initializeEdgesPerNode()
    {
        //задаем смещение по строке в массиве с информацией о ребрах
        let row_delta = this.m;

        for (let i = 0; i < this.m; ++i)
        {
            if (i == 0 || i == this.m - 1)
            {
                this.edges_per_node[i] = 2;
                this.edges_per_node[(this.n - 1) * row_delta + i] = 2;
            }
            else
            {
                this.edges_per_node[i] = 3;
                this.edges_per_node[(this.n - 1) * row_delta + i] = 3
            }
        }

        for (let i = 1; i < this.n - 1; ++i)
        {
            this.edges_per_node[i * row_delta] = 3;
            this.edges_per_node[i * row_delta + this.m - 1] = 3;
        }

        for (let i = 1; i < this.n - 1; ++i)
        {
            for (let j = 1; j < this.m - 1; ++j)
            {
                this.edges_per_node[i * row_delta + j] = 4;
            }
        }
    }

    //функция, инициализируюзая список закрепленных по умолчанию узлов
    initializeLockedNodes()
    {
        this.selected_node = -1;                                    //в массиве this.locked_nodes хранятся индексы 
        this.current_mouse_x = 0;                                   //закрепленных узлов и из координтаты в виде
        this.current_mouse_y = 0;                                   //this.locked_nodes[i]=индекс
        this.locked_nodes = new Array();                            //this.locked_nodes[i+1]=координата_x
        this.locked_nodes.push(0);                                  //this.locked_nodes[i+2]=координата_y, где i%3=0
        this.locked_nodes.push(-0.45 * (this.m - 1) * this.distance_between_nodes);
        this.locked_nodes.push(1);
        this.locked_nodes.push((this.m - 1) * 2);
        this.locked_nodes.push(0.45 * (this.m - 1) * this.distance_between_nodes);
        this.locked_nodes.push(1);
    }

    //поменять количество узлов по оси y
    setN(n)
    {
        //записываем новое значение n
        this.n = n;

        //заново создаем массивы координат и цветов
        this.coord = new Float32Array(this.n * this.m * 2);
        this.old_coord = new Float32Array(this.n * this.m * 2);
        this.color = new Float32Array(3 * this.m * this.n);

        //инициализируем начальные координаты точек
        this.initializeCoords();

        //инициализируем начальное напряжение
        this.stress = new Float32Array(this.m * this.n);
        this.initializeStress();

        //инициализируем массив с информацией о том, сколько смежных ребер у каждой вершины
        this.edges_per_node = new Array(this.m * this.n);
        this.initializeEdgesPerNode();

        //инициализируем индексный массив для рисования ребер
        this.edge_index = new Uint16Array((this.m * (this.n - 1) + this.n * (this.m - 1)) * 2);
        this.initializeEdgeIndex();

        //инициализируем индексный массив для рисования вершин
        this.node_index = new Uint16Array(this.n * this.m);
        this.initializeNodeIndex();

        //инициализируем список закрепленных по умолчанию вершин
        this.locked_nodes = new Array();
        this.initializeLockedNodes();

        //заново создаем буферы для отрисовки
        this.gl.deleteBuffer(this.index_buffer);
        this.gl.deleteBuffer(this.data_buffer);
        this.index_buffer = this.gl.createBuffer();
        this.data_buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
        let size;
        if (this.show_nodes == false)
        {
            size = this.edge_index.BYTES_PER_ELEMENT * this.edge_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.edge_index);
        }
        else
        {
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

    //поменять количество узлов по оси y
    setM(m)
    {
        //записываем новое значение m
        this.m = m;

        //заново создаем массивы координат и цветов
        this.coord = new Float32Array(this.n * this.m * 2);
        this.old_coord = new Float32Array(this.n * this.m * 2);
        this.color = new Float32Array(3 * this.m * this.n);

        //инициализируем начальные координаты точек
        this.initializeCoords();

        //инициализируем начальное напряжение
        this.stress = new Float32Array(this.m * this.n);
        this.initializeStress();

        //инициализируем массив с информацией о том, сколько смежных ребер у каждой вершины
        this.edges_per_node = new Array(this.m * this.n);
        this.initializeEdgesPerNode();

        //инициализируем индексный массив для рисования ребер
        this.edge_index = new Uint16Array((this.m * (this.n - 1) + this.n * (this.m - 1)) * 2);
        this.initializeEdgeIndex();

        //инициализируем индексный массив для рисования вершин
        this.node_index = new Uint16Array(this.n * this.m);
        this.initializeNodeIndex();

        //инициализируем список закрепленных по умолчанию вершин
        this.locked_nodes = new Array();
        this.initializeLockedNodes();

        //заново создаем буферы для отрисовки
        this.gl.deleteBuffer(this.index_buffer);
        this.gl.deleteBuffer(this.data_buffer);
        this.index_buffer = this.gl.createBuffer();
        this.data_buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
        let size;
        if (this.show_nodes == false)
        {
            size = this.edge_index.BYTES_PER_ELEMENT * this.edge_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.edge_index);
        }
        else
        {
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

    //функция, которая позвоняет включить или выключить силу тяжести
    setNeedGravity(need_gravity)
    {
        this.need_gravity = need_gravity;
        if (need_gravity == 1)
        {
            this.gravity = new Float32Array([0, -1, 0]);
        }
        else
        {
            this.gravity = new Float32Array([0, 0, 0]);
        }
    }

    //функция, меняющая расстояние мужду узлами
    setDistanceBetweenNodes(distance_between_nodes)
    {
        //записываем новое расстояние между узлами
        this.distance_between_nodes = distance_between_nodes;

        //заново создаем массивы координат
        this.coord = new Float32Array(this.n * this.m * 2);
        this.old_coord = new Float32Array(this.n * this.m * 2);

        //инициализируем начальное положения узлов
        this.initializeCoords();

        //инициализируем список закрепленных по умолчанию вершин
        this.locked_nodes = new Array();
        this.initializeLockedNodes();

        //инициализируем начальное напряжение
        this.stress = new Float32Array(this.m * this.n);
        this.initializeStress();

        //заново создаем буффер отрисовки
        this.gl.deleteBuffer(this.data_buffer);
        this.data_buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.data_buffer);
        let size = this.coord.BYTES_PER_ELEMENT * this.coord.length + this.color.BYTES_PER_ELEMENT * this.color.length;
        this.gl.bufferData(this.gl.ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.a_Position, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribPointer(this.a_FragColor, 3, this.gl.FLOAT, false, 0, this.coord.BYTES_PER_ELEMENT * this.coord.length);
    }

    //функция, которая позволяет показывать только вершины
    setShowNodes(show_nodes)
    {
        //записываем новое значение флага
        this.show_nodes = show_nodes;

        //удаляем старый индексный буффер
        this.gl.deleteBuffer(this.index_buffer);
        this.index_buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);

        //если нужно показывать ребра, записываем в индексный массив индексы для ребер
        if (this.show_nodes == false)
        {
            let size = this.edge_index.BYTES_PER_ELEMENT * this.edge_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.edge_index);
        }

        //а если нужно показывать только вершины, записываем в индексный массив индексы для вершин
        else
        {
            let size = this.node_index.BYTES_PER_ELEMENT * this.node_index.length;
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, size, this.gl.STATIC_DRAW);
            this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.node_index);
        }
    }

    //обработчик нажатия на клавишу мыши
    mouseDown(mouse_event)
    {
        //если нажата левая клавиша мыши
        if (mouse_event.which == 1)
        {
            //узнаем место клика
            let click_x = (mouse_event.clientX / this.canvas_size * 2 - 1.02);
            let click_y = ((this.canvas_size - mouse_event.clientY) / this.canvas_size * 2 - 0.98);

            //вычисляем смещения индекса в массиве координат по строке и по столбцу
            let coord_row_delta = 2 * this.m;
            let coord_column_delta = 2;

            //переменные, куда запишем индекс выбранной вершины, если найдем ее
            let res_i = -1, res_j = -1;

            //поиск вершины, на которую нажал пользователь
            for (let i = 0; i < this.n && res_i == -1; ++i)
            {
                for (let j = 0; j < this.m && res_i == -1; ++j)     //шагаем по вершинам
                {
                    //если расстояние от какой-то вершины до места клика достаточно мало, можно прекратить поиск и сохранить информацию об этой вершине
                    if (Math.abs(this.coord[i * coord_row_delta + j * coord_column_delta] - click_x) < this.distance_between_nodes / 2
                        &&
                        Math.abs(this.coord[i * coord_row_delta + j * coord_column_delta + 1] - click_y) < this.distance_between_nodes / 2)
                    {
                        res_i = i;
                        res_j = j;
                        this.selected_node = res_i * coord_row_delta + res_j * coord_column_delta;
                        this.current_mouse_x = click_x;
                        this.current_mouse_y = click_y;
                    }
                }
            }
        }

        //если нажата правая клавиша мыши и выделена какая-то вершина, записываем информацию о ней в массив this.locked_nodes
        //и принудительно отпускаем клавшу мыши
        if (mouse_event.which == 3 && this.selected_node != -1)
        {
            this.locked_nodes.push(this.selected_node);
            this.locked_nodes.push(this.current_mouse_x);
            this.locked_nodes.push(this.current_mouse_y);

            this.mouseUp(mouse_event);
        }
    }

    //обработчик того, что пользователь отпустил клавишу мыши
    mouseUp(mouse_event)
    {
        //если пользователь отпустил левую клавишу мыши и сейчас выделена кака-то вершина, то нужно снять выделение
        if (mouse_event.which == 1 && this.selected_node != -1)
        {
            this.selected_node = -1;
        }
    }

    //обработчик того, что пользователь переместил мышь
    mouseMoved(mouse_event)
    {
        //если выделена какая-то вершина
        if (this.selected_node != -1)
        {
            //вычислим положение мыши на данные момент
            let mouse_x = (mouse_event.clientX / this.canvas_size * 2 - 1.02);
            let mouse_y = ((this.canvas_size - mouse_event.clientY) / this.canvas_size * 2 - 0.98);

            //унаем индексы i и j вершины, которая сейчас выделена
            let selected_node_i = Math.trunc(this.selected_node / 2 / this.m);
            let selected_node_j = (this.selected_node / 2) % this.m;

            //создадим флаг и переменные, которые потребуются в цикле ниже
            let flag = false;
            let locked_node_i, locked_node_j, delta_i, delta_j, delta_x, delta_y;

            //шагаем по массиву с информацией о зафиксированных вершинах, напомним, что этот массив имеет вид
            //this.locked_nodes[i]=индекс
            //this.locked_nodes[i+1]=координата_x
            //this.locked_nodes[i+2]=координата_y, где i%3=0
            for (let i = 0; i < this.locked_nodes.length; i += 3)
            {
                locked_node_i = Math.trunc(this.locked_nodes[i] / 2 / this.m);      //узнаем индексы очередной зафиксированной вершины
                locked_node_j = (this.locked_nodes[i] / 2) % this.m;
                delta_i = Math.abs(selected_node_i - locked_node_i);                //вычисляем разность в индексах между зафиксированной                
                delta_j = Math.abs(selected_node_j - locked_node_j);                //вершиной и вершиной, которая сейчас выделена
                delta_x = Math.abs(this.locked_nodes[i + 1] - mouse_x);             //вычисляем разность координат между зафиксированной  
                delta_y = Math.abs(this.locked_nodes[i + 2] - mouse_y);             //вершиной и вершиной, которая сейчас выделена

                //сравниваем длину линии, проведенной из одного узла сетки в другой с расстоянием между вершинами
                //если длина линии меньше расстояния, это значит, что пользователь пытается слишком сильно растянуть ткань,
                //нужно проигнорировать его действия, то есть установить flag=true
                if (Math.sqrt(delta_i * delta_i + delta_j * delta_j) * 2 * this.distance_between_nodes < Math.sqrt(delta_x * delta_x + delta_y * delta_y)
                    &&
                    delta_i + delta_j != 0)
                {
                    flag = true;
                }
            }

            //если пользватель не слишком сильно раснянул ткань
            if (flag == false)
            {
                //меняем координаты выделенной точки
                this.coord[this.selected_node] = mouse_x;
                this.coord[this.selected_node + 1] = mouse_y;

                //снова устанавливаем flag=false и создаем счетчик
                flag = false;
                let i = 0;

                //шагаем по массиву с иформацией о зафиксированных вершинах и проверяем, 
                //не является ли выделенная вершина одной из зафиксированных
                while (i < this.locked_nodes.length && flag == false)
                {
                    if (this.locked_nodes[i] == this.selected_node) flag = true;
                    i += 3;
                }
                i -= 3;

                //если да, то вносим изменения в список зафиксированных вершин
                if (flag == true)
                {
                    this.locked_nodes[i + 1] = mouse_x;
                    this.locked_nodes[i + 2] = mouse_y;
                }

                //сохраняем текущее положение мыши
                this.current_mouse_x = mouse_x;
                this.current_mouse_y = mouse_y;
            }
        }
    }

    //функция интегрирования Верле
    verletIntegration()
    {
        //вычисляем смещения по строке и по столбцу в массиве координат
        let row_delta = 2 * this.m;
        let column_delta = 2;

        //создаем буффер и переменные, куда будем записывать вычисленные координаты
        let buffer, coord, old_coord;

        //шагаем по массиву вершин
        for (let i = 0; i < this.n; ++i)
        {
            for (let j = 0; j < this.m; ++j)
            {
                for (let k = 0; k < 2; ++k)
                {
                    //сохраняем текущее положение вершины в buffer и coord
                    buffer = this.coord[i * row_delta + j * column_delta + k];
                    coord = this.coord[i * row_delta + j * column_delta + k];

                    //сохраняем старое положение вершины в old_coord
                    old_coord = this.old_coord[i * row_delta + j * column_delta + k];

                    //вычисляем новое положение точки. Коэффициент 0.99 отвечает за затухание движение ткани со временем
                    coord = coord + 0.99 * (coord - old_coord) + this.gravity[k] *
                        this.time_step / 1000 * this.time_step / 1000;

                    //перезаписываем значения в массивах координат
                    this.coord[i * row_delta + j * column_delta + k] = coord;
                    this.old_coord[i * row_delta + j * column_delta + k] = buffer;
                }
            }
        }
    }

    //функция, проверяющая расстояния между узлами и не вышли ли узлы за пределы области отрисовки
    satisfyConstraints()
    {
        //вычиляем смещения по строке и столбцу в массиве координат вершин
        let row_delta = 2 * this.m;
        let column_delta = 2;

        //delta length это расстояние между текушими вершинами
        //diff1 и diff2 это коэффициенты растяжения/сжатия ребра
        //delta это вектор, идущий от одной вершины к другой
        //node_movement это вектор, на который мы сместим каждую из вершин
        let delta_length, diff1, diff2;
        let delta = new Float32Array(2);
        let node_movement = new Float32Array(2);

        //сбрасываем значения напряжения
        this.initializeStress();

        //проверка расстояний производится в несколько проходов, количество которых определяется глобальной переменной
        for (let l = 0; l < number_of_iterations; ++l)
        {
            //шагаем по массиву вершин и сдвигаем их к границе области отрисовки, если они вышли за ее пределы
            for (let i = 0; i < this.n; ++i)
            {
                for (let j = 0; j < this.m; ++j)
                {
                    this.coord[i * row_delta + j * column_delta] = Math.min(this.coord[i * row_delta + j * column_delta], 1);
                    this.coord[i * row_delta + j * column_delta] = Math.max(this.coord[i * row_delta + j * column_delta], -1);
                    this.coord[i * row_delta + j * column_delta + 1] = Math.min(this.coord[i * row_delta + j * column_delta + 1], 1);
                    this.coord[i * row_delta + j * column_delta + 1] = Math.max(this.coord[i * row_delta + j * column_delta + 1], -1);
                }
            }

            //вновь шагаем по массиву вершин
            for (let i = 0; i < this.n; ++i)
            {
                for (let j = 0; j < this.m; ++j)
                {
                    //если вершина не находится в последней строке или в последнем столбце
                    if (i != this.n - 1 && j != this.m - 1)
                    {
                        //вычисляем разность координат этой вершины и той вершины, что стоит справа от нее
                        delta[0] = this.coord[i * row_delta + j * column_delta] - this.coord[i * row_delta + (j + 1) * column_delta];
                        delta[1] = this.coord[i * row_delta + j * column_delta + 1] - this.coord[i * row_delta + (j + 1) * column_delta + 1];

                        //вычисляем расстояни между этой вершиной и той вершины, что стоит справа от нее
                        delta_length = delta[0] * delta[0] + delta[1] * delta[1];
                        delta_length = Math.sqrt(delta_length);

                        //вычисляем коээфициент растяжения ребра между этими вершинами
                        diff1 = (delta_length - this.distance_between_nodes) / delta_length;

                        //смещаем вершины друг к другу или друг от друга, чтобы расстояние между ними было правильным
                        for (let k = 0; k < 2; ++k)
                        {
                            node_movement[k] = 0.5 * diff1 * delta[k];
                            this.coord[i * row_delta + j * column_delta + k] -= node_movement[k];
                            this.coord[i * row_delta + (j + 1) * column_delta + k] += node_movement[k];
                        }

                        //вычисляем разность координат этой вершины и той вершины, что стоит снизу от нее
                        delta[0] = this.coord[i * row_delta + j * column_delta] - this.coord[(i + 1) * row_delta + j * column_delta];
                        delta[1] = this.coord[i * row_delta + j * column_delta + 1] - this.coord[(i + 1) * row_delta + j * column_delta + 1];

                        //вычисляем расстояни между этой вершиной и той вершины, что стоит снизу от нее
                        delta_length = delta[0] * delta[0] + delta[1] * delta[1];
                        delta_length = Math.sqrt(delta_length);

                        //вычисляем коээфициент деформации ребра между этими вершинами
                        diff2 = (delta_length - this.distance_between_nodes) / delta_length;

                        //смещаем вершины друг к другу или друг от друга, чтобы расстояние между ними было правильным
                        for (let k = 0; k < 2; ++k)
                        {
                            node_movement[k] = 0.5 * diff2 * delta[k];
                            this.coord[i * row_delta + j * column_delta + k] -= node_movement[k];
                            this.coord[(i + 1) * row_delta + j * column_delta + k] += node_movement[k];
                        }

                        //если это последняя итерация, нужно обновить напряжения в текущем узле и его соседях справа и снизу
                        if (l == number_of_iterations - 1)
                        {
                            this.calculateStress(i, j, diff1, diff2);
                        }
                    }

                    //если текущий узел из последнего столбца, но не из последней сроки
                    if (i != this.n - 1 && j == this.m - 1)
                    {
                        //находим разноость координат между этим узлом и его соседом снизу
                        delta[0] = this.coord[i * row_delta + j * column_delta] - this.coord[(i + 1) * row_delta + j * column_delta];
                        delta[1] = this.coord[i * row_delta + j * column_delta + 1] - this.coord[(i + 1) * row_delta + j * column_delta + 1];

                        //вычисляем расстояние между этими узлами
                        delta_length = delta[0] * delta[0] + delta[1] * delta[1];
                        delta_length = Math.sqrt(delta_length);

                        //вычисляем коээфициент деформации ребра между этими вершинами
                        diff1 = (delta_length - this.distance_between_nodes) / delta_length;

                        //смещаем вершины друг к другу или друг от друга, чтобы расстояние между ними было правильным
                        for (let k = 0; k < 2; ++k)
                        {
                            node_movement[k] = 0.5 * diff1 * delta[k];
                            this.coord[i * row_delta + j * column_delta + k] -= node_movement[k];
                            this.coord[(i + 1) * row_delta + j * column_delta + k] += node_movement[k];
                        }

                        //если это последняя итерация, нужно обновить напряжения в текущем узле и его соседе снизу
                        if (l == number_of_iterations - 1)
                        {
                            this.calculateStress(i, j, diff1, 0);
                        }
                    }

                    //если текущий узел из последней строки, но не из последнего столбца
                    if (i == this.n - 1 && j != this.m - 1)
                    {
                        //находим разноость координат между этим узлом и его соседом справа
                        delta[0] = this.coord[i * row_delta + j * column_delta] - this.coord[i * row_delta + (j + 1) * column_delta];
                        delta[1] = this.coord[i * row_delta + j * column_delta + 1] - this.coord[i * row_delta + (j + 1) * column_delta + 1];

                        //вычисляем расстояние между этими узлами
                        delta_length = delta[0] * delta[0] + delta[1] * delta[1];
                        delta_length = Math.sqrt(delta_length);

                        //вычисляем коээфициент деформации ребра между этими вершинами
                        diff1 = (delta_length - this.distance_between_nodes) / delta_length;

                        //смещаем вершины друг к другу или друг от друга, чтобы расстояние между ними было правильным
                        for (let k = 0; k < 2; ++k)
                        {
                            node_movement[k] = 0.5 * diff1 * delta[k];
                            this.coord[i * row_delta + j * column_delta + k] -= node_movement[k];
                            this.coord[i * row_delta + (j + 1) * column_delta + k] += node_movement[k];
                        }

                        //если это последняя итерация, нужно обновить напряжения в текущем узле и его соседе справа
                        if (l == number_of_iterations - 1)
                        {
                            this.calculateStress(i, j, diff1, 0);
                        }
                    }
                }
            }

            //если выделена какая-то вершина, подвинем ее туда, где сейчас находится указатель мыши
            if (this.selected_node != -1)
            {
                this.coord[this.selected_node] = this.current_mouse_x;
                this.coord[this.selected_node + 1] = this.current_mouse_y;
            }

            //вернем зафиксированные вершины туда, где они должны стоять
            for (let i = 0; i < this.locked_nodes.length; i += 3)
            {
                this.coord[this.locked_nodes[i]] = this.locked_nodes[i + 1];
                this.coord[this.locked_nodes[i] + 1] = this.locked_nodes[i + 2];
            }
        }

        //надем вершину с максимальным напряжением
        let max_stress = 0;
        for (let i = 0; i < this.n * this.m; ++i)
        {
            if (this.stress[i] > max_stress) max_stress = this.stress[i];
        }

        //вычислим нормировочный коэффициент
        let coeff = 1 / max_stress;

        //вычилим смещения по строке и по столбцу в массиве цветов
        let color_row_delta = 3 * this.m;
        let color_column_delta = 3;

        //пройдем по массиву цветов и для каждой вершины на основании напряжения в ней выберем цвет в пределах
        //от красного до синего
        for (let i = 0; i < this.n; ++i)
        {
            for (let j = 0; j < this.m; ++j)
            {
                this.color[i * color_row_delta + j * color_column_delta] = this.stress[i * this.m + j] * coeff;
                this.color[i * color_row_delta + j * color_column_delta + 1] = 0;
                this.color[i * color_row_delta + j * color_column_delta + 2] = 1 - this.stress[i * this.m + j] * coeff;
            }
        }
    }

    calculateStress(i, j, diff1, diff2)
    {
        //берем модуль от коэффициентов растяжения. Эти значения мы будем использовать для вычисления напряжения
        diff1 = Math.abs(diff1);
        diff2 = Math.abs(diff2);

        //задаем смещение по по строкам массива с информацией о напряжении и массива с информацией о количестве ребер,
        //смежных с каждой вершиной
        let row_delta = this.m;


        //если вершина не находится в последней строке или в последнем столбце, то
        //нужно обновить напряжения в текущем узле и его соседях справа и снизу
        if (i != this.n - 1 && j != this.m - 1)
        {
            this.stress[i * row_delta + j] += 1. / this.edges_per_node[i * row_delta + j] * diff1;
            this.stress[i * row_delta + j] += 1. / this.edges_per_node[i * row_delta + j] * diff2;
            this.stress[i * row_delta + j + 1] += 1. / this.edges_per_node[i * row_delta + j + 1] * diff1;
            this.stress[(i + 1) * row_delta + j] += 1. / this.edges_per_node[(i + 1) * row_delta + j] * diff2;
        }

        //если текущий узел из последнего столбца, но не из последней строки, то
        //нужно обновить напряжения в текущем узле и его соседе снизу
        if (i != this.n - 1 && j == this.m - 1)
        {
            this.stress[i * row_delta + j] += 1. / this.edges_per_node[i * row_delta + j] * diff1;
            this.stress[(i + 1) * row_delta + j] += 1. / this.edges_per_node[(i + 1) * row_delta + j] * diff1;
        }

        //если текущий узел из последней строки, но не из последнего столбца, то
        //нужно обновить напряжения в текущем узле и его соседе справа
        if (i == this.n - 1 && j != this.m - 1)
        {
            this.stress[i * row_delta + j] += 1. / this.edges_per_node[i * row_delta + j] * diff1;
            this.stress[i * row_delta + j + 1] += 1. / this.edges_per_node[i * row_delta + j + 1] * diff1;
        }
    }

    //функция отрисовки кадра
    drawFrame()
    {
        //запись координат и цветов в буффер отрисовки
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.coord);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, this.coord.BYTES_PER_ELEMENT * this.coord.length, this.color);

        //очистка экрана
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.clear(this.gl.DEPTH_BUFFER_BIT);

        //если нужно отрисовывать только вершины
        if (this.show_nodes == false)
        {
            this.gl.drawElements(this.gl.LINES, (this.m * (this.n - 1) + this.n * (this.m - 1)) * 2, this.gl.UNSIGNED_SHORT, 0);
        }

        //если нужно отрисовывать ребра
        else
        {
            this.gl.drawElements(this.gl.POINTS, this.n * this.m, this.gl.UNSIGNED_SHORT, 0);
        }

    }

    //шаг симуляции
    simulationStep()
    {
        //проверки, не поменял ли пользователь какие-то значения в окне браузера
        if (eval(this.n_text.value) != this.n) this.setN(eval(this.n_text.value));
        if (eval(this.m_text.value) != this.m) this.setM(eval(this.m_text.value));
        if (eval(this.distance_text.value) != this.distance_between_nodes) this.setDistanceBetweenNodes(eval(this.distance_text.value));
        if (this.need_gravity_checkbox.checked != this.need_gravity) this.setNeedGravity(this.need_gravity_checkbox.checked);
        if (this.show_nodes_checkbox.checked != this.show_nodes) this.setShowNodes(this.show_nodes_checkbox.checked);

        //интегрирование Верле
        this.verletIntegration();

        //проверка расстояний между узлами и того, не вышли ли узлы за пределы области рисования
        this.satisfyConstraints();

        //отрисовка кадра
        this.drawFrame();
    }
}

//главная функция
function main()
{
    //получаем указатели на элементы интерфейса
    const canvas = document.getElementById('webgl');
    const n_text = document.getElementById("n_text");
    const m_text = document.getElementById("m_text");
    const frame_text = document.getElementById("frame_text");
    const distance_text = document.getElementById("distance_text");
    const gravity_checkbox = document.getElementById("gravity_checkbox");
    const show_nodes_checkbox = document.getElementById("show_nodes_checkbox");

    //работаем с контекстом рисования
    const gl = getWebGLContext(canvas);
    initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE);

    //получаем данные из интерфейса
    let n = eval(n_text.value);
    let m = eval(m_text.value);
    let distance_between_nodes = eval(distance_text.value);
    let canvas_size = canvas.width;

    //инициализируем массивы координат
    let coord = new Float32Array(n * m * 2);
    let old_coord = new Float32Array(n * m * 2);

    //задаем смещения индексов по строке и по столбцу
    let row_delta = 2 * m;
    let column_delta = 2;

    //заполняем массивы
    for (let i = 0; i < n; ++i)
    {
        for (let j = 0; j < m; ++j)
        {
            coord[i * row_delta + j * column_delta] = (-0.45 * (m - 1) + j) * distance_between_nodes;
            coord[i * row_delta + j * column_delta + 1] = 1 - i * distance_between_nodes;
            old_coord[i * row_delta + j * column_delta] = coord[i * row_delta + j * column_delta];
            old_coord[i * row_delta + j * column_delta + 1] = coord[i * row_delta + j * column_delta + 1];
        }
    }

    //создаем обьект - симулятор ткани
    frame_drawer = new ClothSimulator(n_text, m_text, distance_text, gravity_checkbox, show_nodes_checkbox, old_coord, coord, canvas_size, gl);

    //назначаем обработчики событий
    canvas.onmousedown = function(mouse_event) { frame_drawer.mouseDown(mouse_event) };
    canvas.onmouseup = function(mouse_event) { frame_drawer.mouseUp(mouse_event) };
    canvas.onmousemove = function(mouse_event) { frame_drawer.mouseMoved(mouse_event) };
}
